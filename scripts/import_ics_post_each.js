const fs = require('fs');
const axios = require('axios');

const input = process.argv[2] || 'tmp/ics_output.json';
const endpointBase = process.argv[3] || 'https://dj-booking-app-kai99.onrender.com';

function toMinutes(time){ const [h,m]=time.split(':').map(Number); return h*60+m; }
function toTime(mins){ const h=Math.floor(mins/60); const m=mins%60; return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0'); }

(async ()=>{
  try{
    const raw = fs.readFileSync(input,'utf8');
    const data = JSON.parse(raw);
    const items = [];

    if(Array.isArray(data.unavailableDates)){
      for(const d of data.unavailableDates){ items.push({date:d}); }
    }

    const slots = data.slotsByDate || {};
    for(const [date, info] of Object.entries(slots)){
      const available = info.slots || [];
      const dow = new Date(date+'T00:00:00').getDay();
      let open=10, close=17;
      if(dow===4||dow===5) close=22;
      if(dow===0) continue;
      const all = [];
      for(let h=open; h<close; h++) all.push(String(h).padStart(2,'0')+':00');
      const missing = all.filter(s=>!available.includes(s));
      if(missing.length===0) continue;
      if(data.unavailableDates && data.unavailableDates.includes(date)) continue;
      const mins = missing.map(s=>toMinutes(s)).sort((a,b)=>a-b);
      let segStart = mins[0]; let segEnd = mins[0]+60;
      for(let i=1;i<mins.length;i++){
        if(mins[i] === segEnd){ segEnd += 60; }
        else{ items.push({date, start_time: toTime(segStart), end_time: toTime(segEnd)}); segStart = mins[i]; segEnd = mins[i]+60; }
      }
      items.push({date, start_time: toTime(segStart), end_time: toTime(segEnd)});
    }

    console.log('Will POST', items.length, 'items to', endpointBase+'/api/blocked-dates');
    for(const it of items){
      try{
        const res = await axios.post(endpointBase+'/api/blocked-dates', it, { headers: { 'Content-Type': 'application/json' } });
        console.log('Posted', it.date, it.start_time||'FULL', '->', res.status);
      }catch(err){ console.error('Failed', it.date, err.response? (err.response.status + ' ' + JSON.stringify(err.response.data)) : err.message); }
    }
  }catch(err){ console.error('Error:', err.message); process.exit(1);} })();
