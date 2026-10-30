// Joining two devices' changes (src/merge.ts): each side's own change kept, both-changed to this device. Usage: node scripts/test-merge.js
const ts=require('typescript');const fs=require('fs');
const src=ts.transpileModule(fs.readFileSync(require('path').join(__dirname,'..','src','merge.ts'),'utf8'),{compilerOptions:{module:1,target:7}}).outputText;
const m={exports:{}};new Function('module','exports',src)(m,m.exports);const {mergeSnapshots}=m.exports;const a=require('assert/strict');
const base={_v:1,settings:{theme:'a',name:'x',hour24:false},dailyTasks:[{id:'1',t:'a',done:false},{id:'2',t:'b',done:false}],notes:[{id:'n1',b:'hi'}],planner:{Mon:[{id:'p1',s:'Phy'}],Tue:[]}};
const mine={_v:1,settings:{theme:'b',name:'x',hour24:false},dailyTasks:[{id:'1',t:'a',done:true},{id:'2',t:'b',done:false},{id:'3',t:'mine new',done:false}],notes:[{id:'n1',b:'hi'}],planner:{Mon:[{id:'p1',s:'Phy'}],Tue:[]}};
const theirs={_v:2,settings:{theme:'a',name:'Sanjay',hour24:false},dailyTasks:[{id:'4',t:'pc new',done:false},{id:'1',t:'a',done:false}],notes:[{id:'n1',b:'hi there'},{id:'n2',b:'pc'}],planner:{Mon:[{id:'p1',s:'Phy'}],Tue:[{id:'p2',s:'Chem'}]}};
const r=mergeSnapshots(base,mine,theirs);

a.equal(r._v,2);a.deepEqual(r.settings,{theme:'b',name:'Sanjay',hour24:false});
a.deepEqual(r.dailyTasks.map(x=>x.id+(x.done?'!':'')),['4','1!','3']); // 2 deleted on PC, 1 ticked here, 3 added here, 4 added on PC
a.deepEqual(r.notes.map(x=>x.b),['hi there','pc']);a.deepEqual(r.planner.Tue.map(x=>x.id),['p2']);
console.log('merge ok');
