import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
// Sandbox for agent-requested files. Flat directory, no traversal, no dotfiles, never overwrite.
const root=()=>resolve(process.env.AGENT_FILES_DIR || 'agent-files');
export function safePath(name:string):string {
  if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name))throw new Error('Invalid file name. Use letters, digits, dot, dash or underscore (max 64).');
  const dir=root(),path=resolve(dir,name);
  if(!path.startsWith(dir+sep))throw new Error('File name escapes the sandbox.');
  return path;
}
export async function createFile(name:string,content:string) {
  if(Buffer.byteLength(content)>10240)throw new Error('File content exceeds 10 KB.');
  const path=safePath(name);await mkdir(root(),{recursive:true});
  try{await writeFile(path,content,{flag:'wx'});}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw new Error(`${name} already exists.`);throw error;}
  return `Created ${name}.`;
}
export async function deleteFile(name:string) {
  try{await unlink(safePath(name));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')throw new Error(`${name} does not exist.`);throw error;}
  return `Deleted ${name}.`;
}
