import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
const stub = { name:'stub', setup(b){
  b.onResolve({ filter: /(\?raw$)|(\/setup$)|(\/storage$)|(api\/index$)/ }, a => ({ path:a.path, namespace:'stub' }));
  b.onLoad({ filter: /.*/, namespace:'stub' }, () => ({ contents:`
const guard = new Proxy(function(){}, { get(_,k){ if(k==='default'||k==='__esModule')return guard; if(k==='loadJSON')return ()=>null; if(k==='saveJSON')return ()=>true; if(k==='loadVersioned')return ()=>null; if(k==='saveVersioned')return ()=>true; if(k==='SCHEMA_VERSION_FIELD')return '__schemaVersion'; throw new Error('stub prop '+String(k)); }, apply(){ throw new Error('stub call'); } });
export default guard; export const loadJSON=()=>null; export const saveJSON=()=>true; export const loadVersioned=()=>null; export const saveVersioned=()=>true; export const SCHEMA_VERSION_FIELD='__schemaVersion';`, loader:'js' }));
}};
const __dir = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(),'qa-find-'));
process.on('exit', () => { try { rmSync(tmp, { recursive:true, force:true }); } catch {} });

// --- findings.ts bundle ---
const res = await build({ entryPoints:[join(__dir,'..','src','qa','findings.ts')], bundle:true, format:'esm', write:false, platform:'node', logLevel:'silent', plugins:[stub] });
const file = join(tmp,'findings.mjs'); writeFileSync(file, res.outputFiles[0].text);
const m = await import('file://' + file.replace(/\\/g,'/'));
if (typeof m.fingerprint !== 'function') throw new Error('fingerprint not exported from findings.ts bundle');
export const fnv1a = m.fnv1a;
export const canonicalRuleId = m.canonicalRuleId;
export const diffRuns = m.diffRuns;
export const diffDetail = m.diffDetail;
export const snapshotOf = m.snapshotOf;
export const gateCount = m.gateCount;
export const effectiveSeverity = m.effectiveSeverity;

// --- securityReport.ts bundle ---
const res2 = await build({ entryPoints:[join(__dir,'..','src','qa','securityReport.ts')], bundle:true, format:'esm', write:false, platform:'node', logLevel:'silent', plugins:[stub] });
const file2 = join(tmp,'securityReport.mjs'); writeFileSync(file2, res2.outputFiles[0].text);
const mr = await import('file://' + file2.replace(/\\/g,'/'));
if (typeof mr.reportToSarif !== 'function') throw new Error('reportToSarif not exported from securityReport.ts bundle');
export const reportToSarif = mr.reportToSarif;
export const sevToSarifLevel = mr.sevToSarifLevel;
export const sarifBaselineState = mr.sarifBaselineState;
export const buildReport = mr.buildReport;
export const reportToJUnit = mr.reportToJUnit;
