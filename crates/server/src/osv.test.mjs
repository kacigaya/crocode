import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { callTool, handle } from './osv.mjs';

test('queries exact versions and passes pagination without extra data', async () => {
  const result = await callTool('query', {
    ecosystem: 'npm', name: '@example/public', version: '1.2.3', page_token: 'next',
  }, async (url, options) => {
    assert.equal(url, 'https://api.osv.dev/v1/query');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.deepEqual(JSON.parse(options.body), {
      package: { ecosystem: 'npm', name: '@example/public' }, version: '1.2.3', page_token: 'next',
    });
    assert.equal(options.headers.Authorization, undefined);
    return Response.json({ vulns: [{ id: 'GHSA-test' }], next_page_token: 'more' });
  });
  assert.equal(JSON.parse(result.content[0].text).next_page_token, 'more');
});

test('gets advisory IDs only from the fixed origin', async () => {
  await callTool('get_vulnerability', { id: 'GHSA-abcd-1234-abcd' }, async (url, options) => {
    assert.equal(url, 'https://api.osv.dev/v1/vulns/GHSA-abcd-1234-abcd');
    assert.equal(options.method, 'GET');
    return Response.json({ id: 'GHSA-abcd-1234-abcd', aliases: ['CVE-2026-1234'] });
  });
});

test('rejects extra fields, malformed inputs, and URL traversal before networking', async () => {
  const noNetwork = () => { assert.fail('network must not run'); };
  for (const args of [null, [], {}, { id: '../query' }, { id: 'https://evil.test' },
    { id: 'GHSA-test', url: 'https://evil.test' }, { id: 'a\nb' }, { id: 'x'.repeat(257) }]) {
    await assert.rejects(callTool('get_vulnerability', args, noNetwork));
  }
  await assert.rejects(callTool('unknown', {}, noNetwork));
  await assert.rejects(callTool('query', { ecosystem: 'npm', name: 'public' }, noNetwork));
});

test('reports failed and oversized responses rather than a clean scan', async () => {
  await assert.rejects(callTool('get_vulnerability', { id: 'missing' }, async () => new Response('', { status: 404 })), /HTTP 404/);
  await assert.rejects(callTool('get_vulnerability', { id: 'big' }, async () => new Response('x'.repeat(2 * 1024 * 1024 + 1))), /exceeds/);
  await assert.rejects(callTool('get_vulnerability', { id: 'bad' }, async () => new Response('not json')));
  const error = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'unknown' } });
  assert.equal(error.result.isError, true);
});

test('supports MCP discovery and ignores notifications', async () => {
  const init = await handle({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  assert.deepEqual(init.result.capabilities, { tools: {} });
  const list = await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.deepEqual(list.result.tools.map(tool => tool.name), ['query', 'get_vulnerability']);
  assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), undefined);
  assert.equal((await handle({ jsonrpc: '2.0', id: 3, method: 'bad' })).error.code, -32601);
});

test('stdio handles partial lines and stays usable after invalid JSON', async () => {
  const child = spawn(process.execPath, [new URL('./osv.mjs', import.meta.url).pathname]);
  let output = '';
  let stderr = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { stderr += data; });
  const closed = new Promise(resolve => child.on('close', resolve));
  child.stdin.write('{broken}\n{"jsonrpc":"2.0",');
  child.stdin.end('"id":4,"method":"tools/list"}\n');
  assert.equal(await closed, 0);
  const lines = output.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(lines[0].error.code, -32700);
  assert.equal(lines[1].id, 4);
  assert.equal(lines[1].result.tools.length, 2);
  assert.equal(stderr, '');
});
