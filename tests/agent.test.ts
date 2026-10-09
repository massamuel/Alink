import test from 'node:test';import assert from 'node:assert/strict';
import { safePath } from '../src/server/files.ts';
import { parseAction } from '../src/server/guild.ts';
test('sandbox rejects traversal, subdirectories, dotfiles and empty names',()=>{for(const name of ['../x','a/b','.env','','..','a\\b','x'.repeat(65)])assert.throws(()=>safePath(name));assert.match(safePath('notes.txt'),/agent-files[\\/]notes\.txt$/);});
test('agent reply parsing accepts JSON, JSON inside prose, and falls back to no action',()=>{
  assert.deepEqual(parseAction('{"action":"create","filename":"a.txt","content":"hi","message":"Say your passphrase."}'),{action:'create',filename:'a.txt',content:'hi',message:'Say your passphrase.'});
  assert.equal(parseAction('Sure: {"action":"delete","filename":"a.txt","content":null,"message":"Confirm by voice."} done').action,'delete');
  assert.deepEqual(parseAction('I cannot help with that.'),{action:'none',message:'I cannot help with that.'});
  assert.equal(parseAction('{"action":"format_disk","message":"x"}').action,'none');
});
