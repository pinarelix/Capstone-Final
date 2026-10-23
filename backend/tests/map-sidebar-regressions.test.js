const fs=require('fs');
const path=require('path');
const vm=require('vm');
const request=require('supertest');
const {app,pool}=require('../server');

describe('Map resource loading',()=>{
    afterAll(async()=>{await pool.end();});
    test('CSP permits fallback tiles without broadening unrelated script permissions',async()=>{
        const response=await request(app).get('/grid-heatmap.html');
        expect(response.status).toBe(200);
        const csp=response.headers['content-security-policy'];
        expect(csp.match(/connect-src[^;]+/)[0]).toContain('https://tile.openstreetmap.org');
        expect(csp.match(/img-src[^;]+/)[0]).toContain('https://tile.openstreetmap.org');
        expect(csp.match(/script-src[^;]+/)[0]).not.toContain('https:');
        expect(csp).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com|api\.mapbox\.com|events\.mapbox\.com|tiles\.mapbox\.com/);
        expect(csp.match(/font-src[^;]+/)[0]).toBe("font-src 'self'");
    });
    test('bundled navigation icon fonts can be reused across page navigations',async()=>{
        const response=await request(app).get('/vendor/webfonts/fa-solid-900.woff2');
        expect(response.status).toBe(200);
        expect(response.headers['cache-control']).toContain('max-age=86400');
    });
    test('an unset Mapbox token selects a token-free raster style and a local background',()=>{
        let options;
        const map={addControl:jest.fn(),on:jest.fn()};
        const context={window:{},maplibregl:{supported:()=>true,Map:function(config){options=config;return map;},NavigationControl:function(){},AttributionControl:function(){}}};
        context.window=context;
        vm.createContext(context);
        for(const file of ['barangay-boundary.js','mapboxHelper.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../../frontend',file),'utf8'),context);
        context.createMapboxMap('map');
        expect(context.mapboxgl).toBeUndefined();
        expect(options.style.sources.basemap.tiles).toEqual(['https://tile.openstreetmap.org/{z}/{x}/{y}.png']);
        expect(options.style.layers[0].type).toBe('background');
        expect(map.on.mock.calls[0][0]).toBe('style.load');
    });
});

describe('Sidebar state before navigation paint',()=>{
    function harness({userId=1,cachedOrder=['patrol.html','dashboard.html'],fetchedAt=Date.now()}={}) {
        const storage=new Map([['sidebarCollapsed','true'],['brgy179.navigation.v1:1',JSON.stringify({order:cachedOrder,fetchedAt})]]);
        const styles=new Map();
        const context={Date,Set,console,window:{},
            sessionStorage:{getItem:key=>key==='user' ? JSON.stringify({id:userId,role:'Deputy Officer'}) : null},
            localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
            document:{documentElement:{dataset:{}},head:{append:node=>styles.set(node.id,node)},
                getElementById:id=>styles.get(id)||null,createElement:()=>({remove(){styles.delete(this.id);}})}
        };
        context.window=context;vm.createContext(context);
        vm.runInContext(fs.readFileSync(path.join(__dirname,'../../frontend/sidebar-state.js'),'utf8'),context);
        return {context,storage,styles};
    }
    test('collapse and order are restored before the body is parsed',()=>{
        const {context,styles}=harness();
        expect(context.document.documentElement.dataset.sidebarCollapsed).toBe('true');
        expect(context.document.documentElement.dataset.sidebarRole).toBe('Executive Officer');
        expect(styles.get('sidebar-order-prepaint').textContent).toContain('href="patrol.html"]{order:0}');
        expect(context.SidebarState.needsRefresh()).toBe(false);
    });
    test('saved navigation is account-specific and untrusted cache values cannot become CSS',()=>{
        const other=harness({userId:2});
        expect(other.context.SidebarState.read().order).toHaveLength(0);
        expect(other.context.SidebarState.needsRefresh()).toBe(true);
        const invalid=harness({cachedOrder:['x"]{display:none}']});
        expect(invalid.styles.size).toBe(0);
    });
    test('already-correct navigation nodes are not detached and re-appended',()=>{
        const {context}=harness();
        const nodes=['patrol.html','dashboard.html'].map(href=>({getAttribute:()=>href}));
        const nav={children:nodes,querySelectorAll:()=>nodes,insertBefore:jest.fn()};
        context.SidebarState.apply(nav,['patrol.html','dashboard.html']);
        expect(nav.insertBefore).not.toHaveBeenCalled();
    });
    test('navigation-order endpoint is not fetched again on every page',async()=>{
        const {context}=harness();
        const item={getAttribute:()=> 'patrol.html',addEventListener:jest.fn()};
        const nav={children:[item],querySelectorAll:()=>[item],insertBefore:jest.fn()};
        context.document.querySelector=()=>nav;
        let ready;
        context.document.addEventListener=(event,callback)=>{ready=callback;};
        context.apiFetch=jest.fn();
        const source=fs.readFileSync(path.join(__dirname,'../../frontend/apiHelper.js'),'utf8');
        vm.runInContext(source.slice(source.indexOf('// Per-account sidebar ordering')),context);
        await ready();
        expect(context.apiFetch).not.toHaveBeenCalled();
    });
    test('all sidebar pages load their cached state script in the head',()=>{
        const folder=path.join(__dirname,'../../frontend');
        for(const filename of fs.readdirSync(folder).filter(file=>file.endsWith('.html'))){
            const html=fs.readFileSync(path.join(folder,filename),'utf8');
            if(html.includes('class="sidebar"'))expect(html.indexOf('src="sidebar-state.js"')).toBeLessThan(html.indexOf('</head>'));
        }
    });
});

describe('Shared sidebar template interactions',()=>{
    function harness(narrow = false) {
        const listeners = {}, storage = new Map();
        const context = {};
        function node() {
            const classes = new Set();
            return { attrs:{},children:[],events:{},dataset:{},offsetParent:{},
                classList:{contains:value=>classes.has(value),add:value=>classes.add(value),toggle(value,force){const add=force===undefined?!classes.has(value):force;if(add)classes.add(value);else classes.delete(value);return add;}},
                setAttribute(key,value){this.attrs[key]=value;}, getAttribute(key){return this.attrs[key];},
                addEventListener(key,callback){this.events[key]=callback;},append(...items){this.children.push(...items);},focus(){context.document.activeElement=this;}
            };
        }
        const sidebar=node(),logo=node(),nav=node(),link=node(),icon=node(),body=node();
        link.classList.add('active');link.textContent='Risk Map';link.querySelectorAll=()=>[icon];nav.querySelectorAll=()=>[link];
        sidebar.querySelector=selector=>selector==='.sidebar-nav'?nav:link;sidebar.querySelectorAll=()=>[link];
        const media={matches:narrow,addEventListener:(event,callback)=>{media.change=callback;}};
        Object.assign(context,{localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},window:{matchMedia:()=>media},
            document:{body,documentElement:{dataset:{}},addEventListener:(key,callback)=>{listeners[key]=callback;},querySelector:selector=>selector==='.sidebar'?sidebar:logo,createElement:node}});
        vm.createContext(context);
        const source=fs.readFileSync(path.join(__dirname,'../../frontend/apiHelper.js'),'utf8');
        const start=source.indexOf('(function setupSidebarCollapse()');
        vm.runInContext(source.slice(start,source.indexOf('})();',start)+5),context);
        listeners.DOMContentLoaded();
        return {context,sidebar,logo,link,icon,body,media,listeners,storage};
    }
    test('desktop navigation exposes current page and keyboard collapse without remounting links',()=>{
        const {logo,sidebar,link,icon,storage}=harness();
        expect(link.attrs['aria-current']).toBe('page');expect(icon.attrs['aria-hidden']).toBe('true');
        logo.events.keydown({key:'Enter',preventDefault:jest.fn()});
        expect(sidebar.classList.contains('collapsed')).toBe(true);expect(storage.get('sidebarCollapsed')).toBe('true');
        expect(logo.attrs['aria-expanded']).toBe('false');
    });
    test('narrow navigation is inert while closed, opens with external control and closes on Escape',()=>{
        const {context,sidebar,body,listeners,media}=harness(true);
        const toggle=body.children[0];expect(sidebar.inert).toBe(true);
        toggle.events.click();expect(sidebar.inert).toBe(false);expect(toggle.attrs['aria-expanded']).toBe('true');
        listeners.keydown({key:'Escape',preventDefault:jest.fn()});
        expect(sidebar.inert).toBe(true);expect(context.document.activeElement).toBe(toggle);
        media.matches=false;media.change();expect(sidebar.inert).toBe(false);
    });
});
