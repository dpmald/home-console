import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { groceryUiEnvironment } from './grocery-ui-environment.mjs';
const names=[...readFileSync('.env.example','utf8').matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map(m=>m[1]);
const env=groceryUiEnvironment(process.env,names,{
  HOME_CONSOLE_GROCERY_AGENT_KEY:'a'.repeat(64),
  HOME_CONSOLE_GROCERY_DEV_DATABASE_URL:'postgresql://test:unused@127.0.0.1:55432/home_console_grocery_dev',
});
for(const name of names)env[name]='';
env.NODE_ENV='production';env.NEXT_PUBLIC_FAMILY_TIMEZONE='America/New_York';
env.HOME_CONSOLE_GROCERY_DEVELOPMENT='1';
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','build'],{env,stdio:'inherit',windowsHide:true});
child.on('exit',code=>{process.exitCode=code??1;});
