const fs = require('fs');
const axios = require('axios');
const ICS_URL = 'https://calendar.google.com/calendar/ical/allfriendsavhire%40gmail.com/public/basic.ics';
const START_DATE = '2026-06-01';
const END_DATE = '2026-07-31';
function pad(n){return String(n).padStart(2,'0');}
function parseICSTime(value){
  if(!value) return null;
  if(/^\d{8}$/.test(value)){
    return { allDay: true, date: `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}` };
  }
  if(/Z$/.test(value)){
    const y=value.slice(0,4), mo=value.slice(4,6), d=value.slice(6,8), hh=value.slice(9,11), mm=value.slice(11,13), ss=value.slice(13,15);
    return { allDay:false, dateObj:new Date(`${y}-${mo}-${d}T${hh}:${mm}:${ss}Z`) };
  }
  const y=value.slice(0,4), mo=value.slice(4,6), d=value.slice(6,8), hh=value.slice(9,11), mm=value.slice(11,13), ss=value.slice(13,15);
  return { allDay:false, dateObj:new Date(`${y}-${mo}-${d}T${hh}:${mm}:${ss}`) };
}
(async ()=>{
  try{
    const res = await axios.get(ICS_URL);
    const ics = res.data;
    const vevents = ics.split(/BEGIN:VEVENT/).slice(1).map(s=>'BEGIN:VEVENT'+s);
    const events = [];
    for(const v of vevents){
      const lines = v.split(/\r?\n/).filter(Boolean);
      const uidLine = lines.find(l=>l.startsWith('UID')) || '';
      const summaryLine = lines.find(l=>l.startsWith('SUMMARY')) || '';
      const dtstartLine = lines.find(l=>l.startsWith('DTSTART')) || '';
      const dtendLine = lines.find(l=>l.startsWith('DTEND')) || '';
      const rruleLine = lines.find(l=>l.startsWith('RRULE')) || '';
      const getVal=(l)=>{const i=l.indexOf(':'); return i>=0?l.slice(i+1).trim():''};
      const dtStartVal = getVal(dtstartLine);
      const dtEndVal = getVal(dtendLine);
      let start = dtStartVal?parseICSTime(dtStartVal):null;
      let end = dtEndVal?parseICSTime(dtEndVal):null;
      if(start && start.allDay && !end){ const d = new Date(start.date); d.setDate(d.getDate()+1); end = { allDay:true, date: d.toISOString().slice(0,10) }; }
      events.push({uid:getVal(uidLine), summary:getVal(summaryLine), rrule: rruleLine?getVal(rruleLine):null, start, end});
    }
    const sd = new Date(START_DATE+'T00:00:00');
    const ed = new Date(END_DATE+'T00:00:00');
    const days = [];
    for(let d=new Date(sd); d<=ed; d.setDate(d.getDate()+1)) days.push(new Date(d));
    const OPERATING_HOURS={0:null,1:{open:10,close:17},2:{open:10,close:17},3:{open:10,close:17},4:{open:10,close:22},5:{open:10,close:22},6:{open:10,close:17}};
    const toMinutes=(dateObj)=>dateObj.getHours()*60+dateObj.getMinutes();
    const slotsByDate={};
    const unavailableDates=[];
    for(const day of days){
      const y=day.getFullYear(), m=pad(day.getMonth()+1), d=pad(day.getDate());
      const key=`${y}-${m}-${d}`;
      const dow=day.getDay();
      const hours=OPERATING_HOURS[dow];
      if(!hours){ slotsByDate[key]={slots:[], isUnavailable:true}; unavailableDates.push(key); continue; }
      const open=hours.open*60, close=hours.close*60;
      const busy=[];
      const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0,0,0);
      const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate()+1, 0,0,0);
      for(const ev of events){
        if(ev.rrule){ /* not expanding recurring events */ }
        if(ev.start && ev.start.allDay){
          const sDate = new Date(ev.start.date+'T00:00:00');
          const eDate = ev.end && ev.end.allDay? new Date(ev.end.date+'T00:00:00') : new Date(sDate.getTime()+24*60*60*1000);
          if(!(eDate<=dayStart || sDate>=dayEnd)) busy.push({start:0,end:24*60});
        } else if(ev.start && ev.start.dateObj){
          const s = ev.start.dateObj;
          const e = ev.end && ev.end.dateObj? ev.end.dateObj : new Date(s.getTime()+60*60*1000);
          if(!(e<=dayStart || s>=dayEnd)){
            const segStart = Math.max(open, toMinutes(new Date(Math.max(s.getTime(), dayStart.getTime()))));
            const segEnd = Math.min(close, toMinutes(new Date(Math.min(e.getTime(), dayEnd.getTime()))));
            if(segStart<segEnd) busy.push({start:segStart,end:segEnd});
          }
        }
      }
      busy.sort((a,b)=>a.start-b.start);
      const merged=[]; for(const r of busy){ if(!merged.length) merged.push({...r}); else{ const last=merged[merged.length-1]; if(r.start<=last.end) last.end=Math.max(last.end,r.end); else merged.push({...r}); }}
      const slots=[];
      for(let s=open;s+60<=close;s+=60){ const e=s+60; const blocked = merged.some(r=>!(e<=r.start || s>=r.end)); if(!blocked) slots.push(`${pad(Math.floor(s/60))}:00`); }
      slotsByDate[key]={slots, isUnavailable: slots.length===0}; if(slots.length===0) unavailableDates.push(key);
    }
    const out = {unavailableDates, slotsByDate};
    const outFile = process.argv[2] || 'tmp/ics_output.json';
    fs.writeFileSync(outFile, JSON.stringify(out,null,2), 'utf8');
    process.stdout.write(outFile);
  }catch(err){ console.error('ERR', err&&err.message); process.exit(1);} })();
