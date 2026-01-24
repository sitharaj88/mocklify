import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../store';
import {
  LayoutDashboard,
  Server,
  Route,
  Database,
  ScrollText,
  Settings,
  Zap,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { Badge, StatusDot, Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from './ui';

type NavItemId = 'dashboard' | 'servers' | 'routes' | 'databases' | 'logs' | 'settings';

interface NavItem {
  id: NavItemId;
  label: string;
  icon: typeof LayoutDashboard;
  badge?: number;
}

export function Sidebar() {
  const { activeView, setActiveView, servers, serverStates } = useStore();
  const [collapsed, setCollapsed] = useState(false);

  const runningCount = Object.values(serverStates).filter(
    (s) => s.status === 'running'
  ).length;

  const navItems: NavItem[] = [
    { id: 'dashboard', label: import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
baimport { motion, AnimatePresence 'import { useStore } from '../store';
import {
  LayoutDabimport {
  LayoutDabases', icon: Data  Layou
   Serid: 'logs', la  Route,qu  Databs'  ScrollTero  Settings,
    Zap,'setti  Che l  ChevronRighgs} from 'lucidengimport { cn } from '.vIimport { Badge, StatusDot, Toolti N
type NavItemId = 'dashboard' | 'servers' | 'routes' | 'databases' | 'logs' | 'settings';

interfiv

interface NavItem {
  id: NavItemId;
  label: string;
  icon: typeof LayoutDashboard;

    id: NavItemId;
 s-  label: string-3  icon: typeof -l  badge?: number;
}

export ful }

export functiup re  const { activeView, setAe
  const [collapsed, setCollapsed] = useState(false);

  const runningCoune-
  const runningCount = Object.values(serverStates)
      (s) => s.status === 'running'
  ).length;

  const na    ).length;

  const navItems: N  
  const nn.d    { id: 'dashboard', label: eIimport { motion, AnimatePresence } from 'framer-motion';
baimpslbaimport { motion, AnimatePresence 'import { useStore }  import {
  LayoutDabimport {
  LayoutDabases', icon: Data  Layou
   Ser    Layou    LayoutDabases', .i   Serid: 'logs', la  Route,qu  Da      Zap,'setti  Che l  ChevronRighgs} from 'lucidengimport { 
 type NavItemId = 'dashboard' | 'servers' | 'routes' | 'databases' | 'logs' | 'settings';

interfiv

interfacete
interfiv

interface NavItem {
  id: NavItemId;
  label: string;
ion.span
              initial={{ o  id: NavItemId;
 0   label: string    icon: typeof it
    id: NavItemId;
 s-  label    s-  label: strinty}

export ful }

export functiup re  const { activeVi text
export funace  const [collapsed, setCollapsed] = useState  
  const runningCoune-
  const runningCount = Objec     const runningCountat      (s) => s.status === 'running'
  ).length;

un  ).length;

  const na    ).lengt  
  const ne v
  cnt="brand" size="sm"   const nn.d    { id
 baimpslbaimport { motion, AnimatePresence 'import { useStore }  import {
  LayoutDabimport {
  Layo)   LayoutDabimport {
  LayoutDabases', icon: Data  Layou
   Ser    LayouTr  LayoutDabases', te   Ser    Layou    LayoutDabases',ol type NavItemId = 'dashboard' | 'servers' | 'routes' | 'databases' | 'logs' | 'settings';

interfiv

interfacete
interfiv

interface   
interfiv

interfacete
interfiv

interface NavItem {
  id: NavItemId;
  label: string;
i   
interf   interfiv

  
interf  )  id: NavItemId;
 ti  label: string  ion.span
                } 0   label: string    icon: typeof it
         id: NavItemId;
 s-  label    s- e
 s-  label    s- fa
export ful }

export functiup roll
export fun: 2export funace  const [collapsed, setCollg'  const runningCoune-
  const runningCount = Objec     con b  const runningCount-r  ).length;

un  ).length;

  const na    ).lengt  
  const ne v
  cnt="brand" size="sm  
un  ).lenlas
  const na ord  const ne v
  cnt="br0/  cnt="bran   baimpslbaimport { motion, AnimatePresence 
   LayoutDabimport {
  Layo)   LayoutDabimport {
  LayoutDabases', icon: la  Layo)   Lalute ins  LayoutDabases', icon: Daxl   Ser    LayouTr  LayoutDabases',iv
interfiv

interfacete
interfiv

interface   
interfiv

interfacete
interfiv

inted-600 flex items-center justify-center shadow-lg shadow-brand-500/25">
           
interfap interfiv

className="tinterfiv

i/>
interf   interfiv

>

interf     id: NavItemId;
     label: stringcei   
interf   i  int  
  
interf  )  id &i ( ti  label: string  ion..d                } 0   labell=         id: NavItemId;
 s-  label    s- e
 s-  label o s-  label    s- e
 s-   s-  label    s- ={export ful }

expo10
export fun   export fun: 2exportfl  const runningCount = Objec     con b  const runningCount-r  ).length;

un t
un  ).length;

  const na    ).lengt  
  const ne v
  cnt="brand" sizssN
  const na  te  const ne v
  cnt="br</  cnt="bran           </motion.div>
    const na  )  cnt="br0/  cnt="bran   es   LayoutDabimport {
  Layo)   LayoutDabimport {
  LayoutDabases',    Layo)   LayoutDabe=  LayoutDabases', icon: laflinterfiv

interfacete
interfiv

interface   
interfiv

interfacete
interfiv

inted-600 flex items-center just  
interfn.dinterfiv

  
interfiniinter{{ opacity: 0 }}
 interfiv

  
inted-ate           
in }}
                exit={{ opacity: 0 }}
                clainterfap ixt
className="tintld 
i/>
interf   interperinse
>

interf     ipx-3 p     label: stringcei     interf   i  int  
  
in    
interf  )  idioi.d s-  label    s- e
 s-  label o s-  label    s- e
 s-   s-  label    s- ={export ful }

expo10
 < s-  label o s-  ke s-   s-  label    s- ={expor  
expo10
export fun   export fun: 2e/* exporr 
un t
un  ).length;

  const na    ).lengt  
  const ne v
  cnt="brand" sizssN
  const na  te  const ne /}
     
  const na ass  const ne v
  cnt="br'f  c items-cen  const na  te  con r  cnt="br</  cnt="bran   50    const na  )  cnt="br0/  cnt="bran   es   x-  Layo)   LayoutDabimport {
  LayoutDabases',    Layo)   Layo>   LayoutDabases',    Layo) /
interfacete
interfiv

interface   
interfiv

interfacete
interfiv

inted-6   interfiv

  
interfn.sinterfiv

i  
interf  iinterfiv

op
inted-0 }interfn.dinterfiv

  
interfiniinac
  
interfiniint   i   interfiv

  
inted-ate        
  
inte      in }}
              t    su                clainterfap ixt
clas  className="tintld 
i/>
interf {ri/>
interf   inte ?ins'>

interf     ipx-3        
in    
interf  )  idioi.d s-  label    s- e
 s-  label o reieninter   s-  label o s-  label    s- e
 s- se s-   s-  label    s- ={expor
 
expo10
 < s-  label o s-  ke s-   sed < s-laexpo10
export fun   export fun: 2e/* exporr 
un t
ufuexporexun t
un  ).length;

  const na    ).x-3 py-
  const na ',
  const       'text-surf  cnt="braner  const na  te  conov     
  const na ass  cons          cnt="br'fion-all duration  LayoutDabases',    Layo)   Layo>   LayoutDabases',    Layo) /
interfacete
interfiv

interface   
interfiv

interfacete
interfiv

inted-6   intedeinterfacete
interfiv

interface   
interfiv

interfacete
intern.interfiv

  
inter    interfiv

i o
inter: 0 interfiv

  
inted-  a
  
interfn.acity: 1 }}
i  
interf  iin   init
op
inted-0 }int}
 i  
  
interfiniinac
  
intetexi-x  
interfini  i  
  
inted-ate        
  
iapsi
   
inte      in /miti                clas  className="tintld 
i/>
interf {ri/>
interf   </i/>
interf {ri/>
interf      interf n.asid
interf     ipx-3  vider>
  );
}
