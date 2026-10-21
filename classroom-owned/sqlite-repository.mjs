import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync} from 'node:fs';
import {dirname} from 'node:path';
import {DurableRepository} from './repository.mjs';

/** Persistent disk adapter for the local Node reference host. */
export class SqliteRepository extends DurableRepository {
  constructor(file,options={}){
    if(!file||file===':memory:')throw Error('A persistent private database path is required.');
    mkdirSync(dirname(file),{recursive:true,mode:0o700});
    const database=new DatabaseSync(file);chmodSync(file,0o600);database.exec('PRAGMA busy_timeout=5000;');
    super(database,options);
  }
}
