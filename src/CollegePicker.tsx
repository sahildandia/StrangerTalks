import { ChevronDown, GraduationCap, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export type CollegeOption = {id:string;name:string};

export default function CollegePicker({id,label,colleges,value,loading=false,placeholder='Select your college',onChange}:{
  id:string;label:string;colleges:CollegeOption[];value:string;loading?:boolean;placeholder?:string;onChange:(id:string)=>void;
}) {
  const [open,setOpen]=useState(false);const [search,setSearch]=useState('');const root=useRef<HTMLDivElement>(null);
  const selected=colleges.find(item=>item.id===value)?.name??'';
  const filtered=colleges.filter(item=>item.name.toLowerCase().includes(search.trim().toLowerCase()));
  useEffect(()=>{
    if(!open)return;
    const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false);};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
  },[open]);
  return <div className="college-picker profile-college-picker" ref={root}>
    <button id={id} className="college-picker-trigger" type="button" aria-labelledby={`${id}-label`} aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-options`} onClick={()=>setOpen(previous=>!previous)}>
      <GraduationCap size={17}/><span>{selected|| (loading?'Loading colleges…':colleges.length?placeholder:'No colleges listed yet')}</span><ChevronDown size={16}/>
    </button>
    {open?<div className="college-picker-menu">
      <label className="college-picker-search"><Search size={15}/><input type="search" aria-label={`Search ${label.toLowerCase()}`} placeholder="Search colleges…" value={search} onChange={event=>setSearch(event.target.value)}/></label>
      <div className="college-picker-options" id={`${id}-options`} role="listbox" aria-labelledby={`${id}-label`}>
        {filtered.map(item=><button type="button" role="option" aria-selected={item.id===value} className={item.id===value?'selected':''} key={item.id} onClick={()=>{onChange(item.id);setOpen(false);setSearch('');}}>{item.name}</button>)}
        {!filtered.length?<p role="status">{loading?'Loading colleges…':'No matching colleges.'}</p>:null}
      </div>
    </div>:null}
  </div>;
}
