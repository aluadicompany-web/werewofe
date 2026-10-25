import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, symlink, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
test('Netlify build rejects missing/insecure server URL and produces self-contained frontend',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'moonfall-build-'));
 try{
  for(const source of ['scripts','public','shared','package.json'])await cp(source,join(dir,source),{recursive:true});
  await symlink(resolve('node_modules'),join(dir,'node_modules'),'dir');
  const run=url=>spawnSync(process.execPath,['scripts/build.mjs'],{cwd:dir,env:{...process.env,NETLIFY:'true',PUBLIC_GAME_SERVER_URL:url},encoding:'utf8'});
  for(const invalid of ['', 'http://game.example','https://game.example/path','https://user:password@game.example']){const r=run(invalid);assert.notEqual(r.status,0);}
  const success=run('https://moonfall-test.onrender.com');assert.equal(success.status,0,success.stderr);
  const config=await readFile(join(dir,'dist/runtime-config.js'),'utf8');assert.equal(config,'window.MOONFALL_CONFIG = {"serverUrl":"https://moonfall-test.onrender.com"};\n');
  for(const file of ['index.html','app.js','shared/rules.js','vendor/socket.io.min.js','fonts/thai/noto-sans-thai-thai-400-normal.woff2','fonts/latin/space-grotesk-latin-400-normal.woff2'])assert.ok((await stat(join(dir,'dist',file))).size>0);
  assert.ok(!(await readdir(join(dir,'dist'))).includes('server'));const html=await readFile(join(dir,'dist/index.html'),'utf8');assert.ok(!html.includes('/socket.io/socket.io.js'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
