const {playGame}=require('./play');
const {STYLES}=require('./bots');
let champ={name:'champ',...STYLES.engine};
const keys=['pts','bonus','guard','dragon','proph','seal','deny','reserve'];
let seed=90000;
function duel(a,b,games){ // 4p: 2 of each, alternating seats
  let wa=0;
  for(let i=0;i<games;i++){const st=i%2?[a,b,a,b]:[b,a,b,a];const r=playGame({styles:st,seed:seed++});
    r.winners.forEach(w=>{if(st[w]===a)wa+=1/r.winners.length});}
  return wa/games;
}
let rnd=1;const R=()=>{rnd=(rnd*16807)%2147483647;return rnd/2147483647};
for(let it=0;it<24;it++){
  const ch={...champ,name:'ch'};
  const k1=keys[Math.floor(R()*keys.length)],k2=keys[Math.floor(R()*keys.length)];
  ch[k1]=Math.max(0,ch[k1]*(0.6+R()*0.8)); ch[k2]=Math.max(0,ch[k2]*(0.6+R()*0.8));
  const w=duel(ch,champ,300);
  if(w>0.54){champ={...ch,name:'champ'};console.log('it',it,'NEW champ win',w.toFixed(2),k1,k2);}
}
console.log(JSON.stringify(Object.fromEntries(keys.map(k=>[k,+champ[k].toFixed(2)]))));
