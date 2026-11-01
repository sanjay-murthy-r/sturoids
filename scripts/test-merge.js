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
// settings alone, changed on both: each setting on its own, a companion's look and a page's layout one level down
const sb={settings:{mood:'elite',hour24:false,mascotTalk:'some',mascotLooks:{sprout:{colors:'',gear:[]},pip:{colors:'',gear:[]}},pageLayout:{focus:{order:['a','b'],hidden:[]}}}};
const sm={settings:{...sb.settings,hour24:true,mascotTalk:'often',mascotLooks:{...sb.settings.mascotLooks,sprout:{colors:'rose',gear:[]}}}};
const st={settings:{...sb.settings,mood:'cheerful',mascotTalk:'asked',mascotLooks:{...sb.settings.mascotLooks,pip:{colors:'mint',gear:['hat']}},pageLayout:{focus:{order:['b','a'],hidden:[]},plan:{order:[],hidden:['x']}}}};
const rs=mergeSnapshots(sb,sm,st).settings;
a.equal(rs.mood,'cheerful');a.equal(rs.hour24,true);a.equal(rs.mascotTalk,'often');
a.deepEqual(rs.mascotLooks,{sprout:{colors:'rose',gear:[]},pip:{colors:'mint',gear:['hat']}});
a.deepEqual(rs.pageLayout,{focus:{order:['b','a'],hidden:[]},plan:{order:[],hidden:['x']}});
// changed on one side only: the other side takes it whole, whichever side it was
a.deepEqual(mergeSnapshots(sb,sb,st).settings,st.settings);a.deepEqual(mergeSnapshots(sb,sm,sb).settings,sm.settings);
// a collection of names: each device's new folder is kept, a folder removed on one goes; settings' lists stay whole
const nb={noteFolders:['A','B'],settings:{tabSlots:['tasks','focus','planner']}};
const rn=mergeSnapshots(nb,{noteFolders:['A','B','Mine'],settings:{tabSlots:['notes','focus','planner']}},{noteFolders:['B','Theirs'],settings:{tabSlots:['tasks','scores','planner']}});
a.deepEqual(rn.noteFolders,['B','Mine','Theirs']);a.deepEqual(rn.settings.tabSlots,['notes','focus','planner']);
console.log('merge ok');
