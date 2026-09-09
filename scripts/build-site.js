import {readFileSync,writeFileSync,mkdirSync,cpSync,existsSync,lstatSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import vm from 'node:vm';
const root = path.resolve(import.meta.dirname,'..');
const output = path.join(root,'_site');
// Only remove the fixed generated directory inside this workspace. Refuse a
// symlink so an unexpected local setup cannot redirect the build cleanup.
if (path.dirname(output) !== root || path.basename(output) !== '_site') throw Error('Unsafe build output');
if (existsSync(output)) {
  if (lstatSync(output).isSymbolicLink()) throw Error('Build output must not be a symlink');
  rmSync(output,{recursive:true,force:true});
}
mkdirSync(output,{recursive:true});
for (const file of ['index.html','sports.html','sports-public.json','offline.html','manifest.webmanifest','sw.js','.nojekyll','assets','reports']) {
  cpSync(path.join(root,file),path.join(output,file),{recursive:true});
}
let html = readFileSync(path.join(root,'index.html'),'utf8');
const dependencies = [...html.matchAll(/<script src="(\.\/lib\/[^"<>]+\.js)"><\/script>/g)].map(match => match[1]);
if (dependencies.length < 7) throw Error('Expected all shared application dependencies');
const hash = createHash('sha256').update(html);
for (const relative of dependencies) {
  const source = path.resolve(root,relative);
  if (!source.startsWith(root + path.sep) || !existsSync(source)) throw Error('Missing dependency: '+relative);
  const code = readFileSync(source,'utf8');
  new vm.Script(code,{filename:relative});
  hash.update(code);
  mkdirSync(path.join(output,'lib'),{recursive:true});
  cpSync(source,path.join(output,relative));
  // Ship critical application code with the document. A stale Pages artifact
  // must not strand the UI behind a missing shared-script request.
  html = html.replace('<script src="'+relative+'"></script>','<script data-bundled="'+relative+'">\n'+code.replace(/<\/script/gi,'<\\/script')+'\n</script>');
}
const version = hash.digest('hex').slice(0,12);
html = html.replace('</head>','<meta name="app-version" content="'+version+'">\n</head>');
writeFileSync(path.join(output,'index.html'),html);
writeFileSync(path.join(output,'version.json'),JSON.stringify({version},null,2)+'\n');
console.log('Built site '+version+' with '+dependencies.length+' bundled application scripts.');
