import { MongoClient, Binary } from 'mongodb';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Workspace } from '../shared/types.ts';
import { newWorkspace } from './engine.ts';
const root = resolve('.data');
export class Store {
  private client: MongoClient | null = null;
  private tails = new Map<string, Promise<unknown>>();
  mode: 'mongodb' | 'local' = 'local';
  async init() {
    await mkdir(root,{recursive:true,mode:0o700});
    if (process.env.MONGODB_URI) {
      this.client = new MongoClient(process.env.MONGODB_URI,{serverSelectionTimeoutMS:5000});
      await this.client.connect(); this.mode='mongodb';
    }
  }
  private db() { return this.client!.db(process.env.MONGODB_DB || 'alink'); }
  private valid(key:string) { if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid workspace.'); return key; }
  async get(key:string):Promise<Workspace> {
    this.valid(key);
    if (this.client) {
      const collection = this.db().collection<{_id:string;value:Workspace}>('workspaces');
      await collection.updateOne({_id:key},{$setOnInsert:{value:newWorkspace()}},{upsert:true});
      return (await collection.findOne({_id:key}))!.value;
    }
    try { return JSON.parse(await readFile(resolve(root,key+'.json'),'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return newWorkspace(); }
  }
  async update<T>(key:string, mutate:(ws:Workspace)=>T):Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const operation = previous.catch(()=>{}).then(async()=> {
      for(let attempt=0;attempt<5;attempt++) {
        const ws = await this.get(key), revision=ws.revision, result=mutate(ws); ws.revision++;
        if (this.client) {
          const saved=await this.db().collection<{_id:string;value:Workspace}>('workspaces').replaceOne({_id:key,'value.revision':revision},{value:ws});
          if (!saved.matchedCount) continue;
        } else {
          const temporary=resolve(root,key+'.tmp'); await writeFile(temporary,JSON.stringify(ws),{mode:0o600}); await rename(temporary,resolve(root,key+'.json'));
        }
        return result;
      }
      throw new Error('Concurrent update. Please retry.');
    });
    this.tails.set(key,operation); try { return await operation; } finally { if(this.tails.get(key)===operation) this.tails.delete(key); }
  }
  async saveAudio(key:string,id:string,bytes:Buffer) {
    this.valid(key); if(!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid recording ID.');
    if(this.client) await this.db().collection('recordings').insertOne({ owner:key, recordingId:id, audio:new Binary(bytes), mimeType:'audio/wav',createdAt:new Date() });
    else { const dir=resolve(root,key);await mkdir(dir,{recursive:true,mode:0o700}); await writeFile(resolve(dir,id+'.wav'),bytes,{mode:0o600}); }
  }
  async audio(key:string,id:string):Promise<Buffer|null> {
    this.valid(key); if(!/^[a-f0-9-]{36}$/.test(id)) return null;
    if(this.client) { const doc=await this.db().collection('recordings').findOne({owner:key,recordingId:id});return doc ? Buffer.from((doc.audio as Binary).buffer) : null; }
    try {return await readFile(resolve(root,key,id+'.wav'));} catch {return null;}
  }
  async removeAudio(key:string,id:string) {
    this.valid(key);if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('Invalid recording ID.');
    if(this.client) await this.db().collection('recordings').deleteOne({owner:key,recordingId:id});
    else await unlink(resolve(root,key,id+'.wav')).catch(e=>{if(e.code!=='ENOENT')throw e;});
  }
  async close(){ await this.client?.close(); }
}
