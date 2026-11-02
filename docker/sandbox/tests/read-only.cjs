const fs = require('node:fs');
const net = require('node:net');
const assert = require('node:assert/strict');
assert.equal(fs.readFileSync('/repo/hello.txt','utf8').trim(),'read-ok');
for (const path of ['/repo/blocked','/outside/blocked','/etc/blocked']) {
  assert.throws(() => fs.writeFileSync(path,'bad'));
}
const socket=net.connect({host:'1.1.1.1',port:443});
socket.on('connect',()=>{ console.error('Network escaped');process.exit(1); });
socket.on('error',error=>{ assert.ok(['EPERM','EACCES','ENETUNREACH'].includes(error.code),error.code); console.log('PASS: reads allowed; writes and network blocked ('+error.code+')'); });
setTimeout(()=>{console.error('Network result inconclusive');process.exit(1)},5000).unref();
