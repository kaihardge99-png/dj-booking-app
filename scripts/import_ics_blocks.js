const fs = require('fs');
const axios = require('axios');

const input = process.argv[2] || 'tmp/ics_output.json';
const endpoint = process.argv[3] || 'http://localhost:5000/api/blocked-dates/bulk';

function toMinutes(time){ const [h,m]=time.split(':').map(Number); return h*60+m; }
function toTime(mins){ const h=Math.floor(mins/60); const m=mins%60; return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0'); }

(async ()=>{
  try{
    const raw = fs.readFileSync(input,'utf8');
    const data = JSON.parse(raw);
    const items = [];

    // full-day unavailable dates
    if(Array.isArray(data.unavailableDates)){
      for(const d of data.unavailableDates){ items.push({date:d}); }
    }

    // partials: compute missing slots from slotsByDate
    const slots = data.slotsByDate || {};
    for(const [date, info] of Object.entries(slots)){
      const available = info.slots || [];
      // determine operating hours
      // Mon-Fri 10-17 (Thu/Fri 10-22), Sat 10-17, Sun closed
      const dow = new Date(date+'T00:00:00').getDay();
      let open=10, close=17;
      if(dow===4||dow===5) close=22;
      if(dow===0){ continue; }
      const all = [];
      for(let h=open; h<close; h++) all.push(String(h).padStart(2,'0')+':00');
      const missing = all.filter(s=>!available.includes(s));
      if(missing.length===0) continue;
      // don't create full-day entry if date already in unavailableDates
      if(data.unavailableDates && data.unavailableDates.includes(date)) continue;
      // merge contiguous missing slots into segments
      const mins = missing.map(s=>toMinutes(s)).sort((a,b)=>a-b);
      let segStart = mins[0]; let segEnd = mins[0]+60;
      for(let i=1;i<mins.length;i++){
        if(mins[i] === segEnd){ segEnd += 60; }
        else{ items.push({date, start_time: toTime(segStart), end_time: toTime(segEnd)}); segStart = mins[i]; segEnd = mins[i]+60; }
      }
      // push last
      items.push({date, start_time: toTime(segStart), end_time: toTime(segEnd)});
    }

    console.log('Prepared items count:', items.length);
    // POST to endpoint
    const res = await axios.post(endpoint, items, { headers: { 'Content-Type': 'application/json' } });
    console.log('Response status:', res.status);
    console.log(JSON.stringify(res.data, null, 2));
  }catch(err){ console.error('Error:', err.response? err.response.data : err.message); process.exit(1);} })();
