/**
 * Pruebas de autenticación y aislamiento entre negocios contra una base PostgreSQL real.
 *
 * Uso:
 *   DATABASE_URL=postgresql://…/pollystock_test AUTH_SECRET=<32+ caracteres> npm run test:auth
 *
 * Seguridad: se niega a ejecutarse si el nombre de la base no contiene "test",
 * para no tocar nunca datos reales. Borra al final todo lo que crea.
 */
process.env.NODE_ENV = 'test';
import { AddressInfo } from 'node:net';
import jwt from 'jsonwebtoken';
import prisma from '../src/config/db';
import app from '../src/server';
import { registerAccount, TOKEN_AUDIENCE, TOKEN_ISSUER } from '../src/services/authService';
import { getInventoryAnalytics } from '../src/services/analyticsService';

const dbUrl = process.env.DATABASE_URL || '';
if (!/test/i.test(new URL(dbUrl).pathname)) {
  console.error('Abortado: DATABASE_URL debe apuntar a una base de pruebas (su nombre debe contener "test").');
  process.exit(1);
}

let passed = 0;
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? '  ✓' : '  ✗ FALLA:'} ${name}${!ok && detail ? ` → ${detail}` : ''}`);
};

let BASE = '';
async function api(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json };
}

const stamp = Date.now();
const emailA = `ana.${stamp}@prueba-test.com`;
const emailB = `beto.${stamp}@prueba-test.com`;

(async () => {
  const server = app.listen(0);
  BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

  try {
    console.log('\n1. Registro');
    const regA = await api('POST', '/auth/register', undefined, { name: 'Ana', email: emailA, password: 'Clave123!', businessName: 'Papelería Ana' });
    check('responde 201 con token', regA.status === 201 && typeof regA.json?.data?.token === 'string', JSON.stringify(regA.json));
    check('no devuelve passwordHash', !JSON.stringify(regA.json).includes('passwordHash'));
    check('crea el negocio con su nombre, sin configurar', regA.json?.data?.business?.name === 'Papelería Ana' && regA.json?.data?.business?.isConfigured === false);
    const userA = await prisma.user.findUnique({ where: { email: emailA } });
    check('guarda la contraseña como hash (no en texto plano)', !!userA && userA.passwordHash !== 'Clave123!' && userA.passwordHash.includes(':'));
    check('usuario y negocio quedan enlazados 1 a 1', userA?.businessId === regA.json?.data?.business?.id);
    const tokenA = regA.json.data.token as string;
    const businessA = regA.json.data.business.id as string;

    const regB = await api('POST', '/auth/register', undefined, { name: 'Beto', email: emailB, password: 'Clave456!', businessName: 'Ferretería Beto' });
    const tokenB = regB.json.data.token as string;
    const businessB = regB.json.data.business.id as string;
    check('cada cuenta recibe un negocio distinto', businessA !== businessB);

    const missing = await api('POST', '/auth/register', undefined, { name: 'Sin negocio', email: `x.${stamp}@prueba-test.com`, password: 'Clave123!' });
    check('exige el nombre del negocio', missing.status === 400);

    console.log('\n2. Correo duplicado');
    const dup = await api('POST', '/auth/register', undefined, { name: 'Otra', email: `  ${emailA.toUpperCase()} `, password: 'Clave123!', businessName: 'Otro negocio' });
    check('rechaza el mismo correo (aunque cambien mayúsculas/espacios) con 409', dup.status === 409 && dup.json?.code === 'EMAIL_IN_USE');
    const businessesBefore = await prisma.business.count();
    let txFailed = false;
    try {
      await registerAccount({ name: 'Carrera', email: emailA, password: 'Clave123!', businessName: 'No debe quedar' });
    } catch {
      txFailed = true;
    }
    check('si el registro falla, la transacción no deja un negocio huérfano', txFailed && (await prisma.business.count()) === businessesBefore);

    console.log('\n3. Contraseña incorrecta');
    const bad = await api('POST', '/auth/login', undefined, { email: emailA, password: 'incorrecta' });
    check('rechaza con 401', bad.status === 401 && bad.json?.code === 'INVALID_CREDENTIALS');
    const noUser = await api('POST', '/auth/login', undefined, { email: `nadie.${stamp}@prueba-test.com`, password: 'Clave123!' });
    check('correo inexistente da el mismo mensaje (no revela cuentas)', noUser.status === 401 && noUser.json?.message === bad.json?.message);

    console.log('\n4. Login');
    const login = await api('POST', '/auth/login', undefined, { email: emailA.toUpperCase(), password: 'Clave123!' });
    check('responde con token, usuario y su negocio', login.status === 200 && !!login.json?.data?.token && login.json?.data?.business?.id === businessA);
    check('no devuelve passwordHash', !JSON.stringify(login.json).includes('passwordHash'));
    const decoded: any = jwt.decode(login.json.data.token);
    check('el token es un JWT con expiración, emisor y audiencia', !!decoded?.exp && decoded.iss === TOKEN_ISSUER && decoded.aud === TOKEN_AUDIENCE && decoded.sub === userA?.id);
    const me = await api('GET', '/auth/me', tokenA);
    check('/auth/me devuelve la sesión actual', me.status === 200 && me.json?.data?.user?.email === emailA && me.json?.data?.business?.id === businessA);

    console.log('\n5. Tokens inválidos o expirados');
    check('sin token → 401', (await api('GET', '/products')).status === 401);
    check('token basura → 401', (await api('GET', '/products', 'abc.def.ghi')).status === 401);
    check('token alterado → 401', (await api('GET', '/products', tokenA.slice(0, -2) + 'xx')).status === 401);
    const otherSecret = jwt.sign({}, 'otro-secreto-que-no-es-el-del-servidor-1234567890', { subject: userA!.id, issuer: TOKEN_ISSUER, audience: TOKEN_AUDIENCE, expiresIn: '1h' });
    check('token firmado con otro secreto → 401', (await api('GET', '/products', otherSecret)).status === 401);
    const expired = jwt.sign({}, process.env.AUTH_SECRET!, { subject: userA!.id, issuer: TOKEN_ISSUER, audience: TOKEN_AUDIENCE, expiresIn: -10 });
    check('token expirado → 401', (await api('GET', '/products', expired)).status === 401);
    const noneAlg = jwt.sign({ sub: userA!.id, iss: TOKEN_ISSUER, aud: TOKEN_AUDIENCE }, '', { algorithm: 'none' } as any);
    check('token sin firma (alg "none") → 401', (await api('GET', '/products', noneAlg)).status === 401);

    console.log('\n6. Acceso al negocio propio');
    const setup = await api('PUT', '/business', tokenA, { name: 'Papelería Ana', businessType: 'Papelería', productType: 'Cuadernos', defaultUnit: 'Unidad', useMinStock: true, minStock: 5 });
    check('completa la configuración de su negocio', setup.status === 200 && setup.json?.data?.id === businessA && setup.json?.data?.businessType === 'Papelería');
    const prodA = await api('POST', '/products', tokenA, { name: 'Cuaderno A4', basePrice: 2.5, stockQuantity: 10, dynamicAttributes: {} });
    check('crea un producto', prodA.status === 201 || prodA.status === 200, JSON.stringify(prodA.json));
    const productA = prodA.json?.data?.id as string;
    const listA = await api('GET', '/products', tokenA);
    check('ve sus productos', listA.status === 200 && listA.json.data.some((p: any) => p.id === productA));
    const movA = await api('POST', '/movements', tokenA, { productId: productA, type: 'ENTRY', quantity: 5 });
    check('registra un movimiento en su producto', movA.status === 201 || movA.status === 200, JSON.stringify(movA.json));
    const attrA = await api('POST', '/attributes', tokenA, { attributes: [{ name: 'Color', dataType: 'TEXT', isRequired: false }] });
    const attributeA = attrA.json?.data?.[0]?.id as string;
    check('crea una característica', !!attributeA);

    console.log('\n7. Bloqueo de acceso a otro negocio');
    const listB = await api('GET', '/products', tokenB);
    check('B no ve los productos de A', listB.status === 200 && !listB.json.data.some((p: any) => p.id === productA));
    check('B no puede leer el producto de A', (await api('GET', `/products/${productA}`, tokenB)).status === 404);
    check('B no puede editar el producto de A', (await api('PUT', `/products/${productA}`, tokenB, { name: 'hack', basePrice: 1, stockQuantity: 0 })).status === 404);
    check('B no puede borrar el producto de A', (await api('DELETE', `/products/${productA}`, tokenB)).status === 404);
    const movB = await api('POST', '/movements', tokenB, { productId: productA, type: 'EXIT', quantity: 1 });
    check('B no puede mover stock de A', movB.status >= 400 && movB.status < 500, `${movB.status}`);
    const movsB = await api('GET', `/movements?productId=${productA}`, tokenB);
    check('B no ve los movimientos de A', movsB.status === 200 && movsB.json.data.length === 0);
    const movId = movA.json?.data?.id;
    if (movId) check('B no puede leer un movimiento de A por id', (await api('GET', `/movements/${movId}`, tokenB)).status === 404);
    await api('POST', '/attributes', tokenB, { attributes: [{ id: attributeA, name: 'HACK', dataType: 'TEXT', isRequired: false }] });
    const attrsA = (await api('GET', '/attributes', tokenA)).json.data;
    check('B no puede modificar las características de A', attrsA.length === 1 && attrsA[0].name === 'Color');
    await api('PUT', '/business', tokenB, { id: businessA, name: 'Hackeado', businessType: 'X', productType: 'X', defaultUnit: 'Unidad' });
    const bizA = await prisma.business.findUnique({ where: { id: businessA } });
    check('B no puede cambiar el negocio de A (aunque envíe su id)', bizA?.name === 'Papelería Ana');
    const productAfter = await prisma.product.findUnique({ where: { id: productA } });
    check('el stock de A no cambió por intentos de B', Number(productAfter?.stockQuantity) === 15);

    console.log('\n8. Endpoints de IA protegidos');
    check('/ai/insights sin token → 401', (await api('GET', '/ai/insights')).status === 401);
    check('/ai/chat sin token → 401', (await api('POST', '/ai/chat', undefined, { message: 'hola' })).status === 401);
    let rejected = false;
    try {
      await getInventoryAnalytics('');
    } catch {
      rejected = true;
    }
    check('el análisis exige un negocio (no usa "el primero" de la base)', rejected);
    const analyticsA = await getInventoryAnalytics(businessA);
    check('el análisis de A solo contiene datos de A', (analyticsA as any).business?.id === businessA);
  } finally {
    // Limpieza: borrar todo lo creado por esta prueba
    const users = await prisma.user.findMany({ where: { email: { endsWith: '@prueba-test.com' } } });
    const ids = users.map((u) => u.businessId);
    await prisma.movement.deleteMany({ where: { product: { businessId: { in: ids } } } });
    await prisma.product.deleteMany({ where: { businessId: { in: ids } } });
    await prisma.attribute.deleteMany({ where: { businessId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
    await prisma.business.deleteMany({ where: { id: { in: ids } } });
    server.close();
    await prisma.$disconnect();
  }

  console.log(`\nResultado: ${passed} correctas, ${failed} fallidas`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
