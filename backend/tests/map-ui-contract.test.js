// Execute the real map adapter with a small DOM/Mapbox boundary double. These
// checks catch configuration/render/filter wiring errors; they do not claim
// to replace a rendered browser smoke test.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Record map UI contract', () => {
    function harness() {
        const elements = new Map();
        let context;
        const node = () => ({ children: [], dataset: {}, attrs: {}, tabIndex: -1, handlers: {},
            append(child) { this.children.push(child); },
            setAttribute(key, value) { this.attrs[key] = value; }, getAttribute(key) { return this.attrs[key]; },
            addEventListener(key, callback) { this.handlers[key] = callback; },
            focus() { context.document.activeElement = this; }
        });
        const element = id => {
            if (!elements.has(id)) elements.set(id, {
                value: id === 'heatmapGranularity' || id === 'heatmapIncidentType' ? 'all' : '',
                textContent: '', style: {}, children: [], options: [],
                replaceChildren() { this.children = []; this.options = []; },
                append(child) { this.children.push(child); }, add(option) { this.options.push(option); },
                querySelectorAll() { return this.children; }, contains(target) { return this.children.includes(target); },
                addEventListener: jest.fn()
            });
            return elements.get(id);
        };
        const handlers = {};
        const source = { setData: jest.fn() };
        const mapStub = { getSource: () => source, getLayer: () => true, setPaintProperty: jest.fn(),
            addSource: jest.fn(), addLayer: jest.fn(), queryRenderedFeatures: jest.fn(),
            getCanvas: () => ({ style: {} }), on: jest.fn((event, ...args) => { handlers[event] = args[args.length - 1]; }) };
        const data = { thresholds: { level2: 40, level3: 80 }, records: [
            { id: 1, blotter_number: 'QA-1', incident_type: 'Theft', date: '2026-10-01', latitude: 14.75, longitude: 121.07, cart_score: 60 },
            { id: 2, blotter_number: 'QA-2', incident_type: 'Robbery', date: '2026-11-01', latitude: 14.751, longitude: 121.071, cart_score: 90 }
        ] };
        context = { console, Map, Set, Number, Date, URLSearchParams,
            document: { addEventListener: jest.fn(), getElementById: element, createElement: node },
            Option: function Option(text, value) { this.text = text; this.value = value; },
            createMapboxMap: () => mapStub, apiFetch: jest.fn(async () => ({ ok: true, json: async () => data })),
            startLivePolling: jest.fn(), openRecordGroup: jest.fn()
        };
        context.window = context;
        vm.createContext(context);
        for (const filename of ['barangay-boundary.js','heatmap-analytics.js','grid-heatmap.js']) vm.runInContext(
            fs.readFileSync(path.join(__dirname, '../../frontend', filename), 'utf8'), context);
        return { context, element, source, handlers, mapStub };
    }

    test('both map layers and the high-risk KPI bind to thresholds while the legend stays plain-language', async () => {
        const { context, handlers, mapStub, source, element } = harness();
        context.initializeMap(); handlers['style.load'](); await context.loadRealData();
        expect(mapStub.setPaintProperty.mock.calls.at(-1)[2]).toEqual(['step', ['get','cart_score'], '#10b981', 40, '#f59e0b', 80, '#ef4444']);
        expect(element('legendHigh').textContent).toBe('');
        expect(element('kpi-high').textContent).toBe(1);
        expect(source.setData.mock.calls.at(-1)[0].features.map(feature => feature.properties.id)).toEqual([1,2]);
    });

    test('click selection is restricted to the category currently visible after filtering', async () => {
        const { context, handlers, mapStub, element } = harness();
        context.initializeMap(); handlers['style.load'](); await context.loadRealData();
        element('heatmapIncidentType').value = 'Property Crimes';
        context.applyFilterAndRender();
        mapStub.queryRenderedFeatures.mockReturnValue([{ properties: { id: 1 } }, { properties: { id: 2 } }]);
        handlers.click({ point: { x: 100, y: 100 } });
        expect(context.openRecordGroup.mock.calls[0][0].map(row => row.id)).toEqual([1]);
    });

    test('map and patrol pages load their new adapter scripts from real local assets', () => {
        for (const filename of ['grid-heatmap.html','patrol.html']) {
            const fullPath = path.join(__dirname, '../../frontend', filename);
            const html = fs.readFileSync(fullPath, 'utf8');
            for (const match of html.matchAll(/<script[^>]+src="([^"?]+)"/g)) {
                if (!/^https?:/.test(match[1])) expect(fs.existsSync(path.resolve(path.dirname(fullPath), match[1]))).toBe(true);
            }
            if (filename === 'grid-heatmap.html') expect(html).not.toContain('toggleStreetBtn');
        }
    });

    test('desktop workspaces use bounded page shells and patrol suggestions share the schedules table', () => {
        const pages = ['dashboard.html','incident.html','incident-view.html','grid-heatmap.html','patrol.html','report.html','users.html','settings.html'];
        for (const filename of pages) {
            const html = fs.readFileSync(path.join(__dirname, '../../frontend', filename), 'utf8');
            expect(html).toMatch(/<body[^>]*class="[^"]*workspace-page/);
        }
        const patrol = fs.readFileSync(path.join(__dirname, '../../frontend/patrol.html'), 'utf8');
        expect(patrol).toContain('Patrol Planning');
        expect(patrol).toContain('<option value="Suggested">Suggested</option>');
        expect(patrol).not.toContain('Active Priority Recommendations');
        expect(patrol).not.toContain('id="recommendationsContainer"');
        expect(patrol).not.toContain('patrol-search.js');
        expect(patrol).toMatch(/id="monthSelect"[^>]+type="date"/);
        expect(patrol).toContain('id="scheduleRecordSelect"');
        expect(patrol).toContain('Active heatmap record');
        expect(patrol).toContain('id="scheduleTeamName"');
        expect(patrol).toContain('Team members');
        expect(patrol).not.toContain('id="scheduleMapPicker"');

        const heatmap = fs.readFileSync(path.join(__dirname, '../../frontend/grid-heatmap.html'), 'utf8');
        expect(heatmap).toMatch(/id="heatmapPeriod"[^>]+type="date"/);
        expect(heatmap).not.toContain('heatmapCalendarPopover');

        const dashboard = fs.readFileSync(path.join(__dirname, '../../frontend/dashboard.html'), 'utf8');
        const incident = fs.readFileSync(path.join(__dirname, '../../frontend/incident.html'), 'utf8');
        expect(dashboard).not.toContain('Assigned Blotter Mediation');
        expect(dashboard).not.toContain('mediation-tasks.js');
        expect(incident).not.toContain('mediationAssignPanel');
        expect(incident).not.toContain('mediation-assign.js');
    });

    test('record data remains available before basemap tiles finish loading', async () => {
        const { context,element } = harness();
        context.initializeMap(); // No style/tiles completion event yet.
        await context.loadRealData();
        expect(element('kpi-incidents').textContent).toBe(2);
        expect(element('kpi-high').textContent).toBe(1);
    });

    test('period filters are sent to the server instead of loading a record window', async () => {
        const {context,element} = harness();
        element('heatmapGranularity').value = 'month';
        element('heatmapPeriod').value = '2026-10-15';
        await context.loadRealData();
        const requested = String(context.apiFetch.mock.calls[0][0]);
        expect(requested).toContain('granularity=month');
        expect(requested).toContain('period=2026-10-01');
        expect(requested).not.toContain('window_days');
    });
});

describe('Light record detail panel', () => {
    function panel(formType, admin = true) {
        const elements = new Map();
        const element = id => {
            if (!elements.has(id)) elements.set(id, { innerHTML:'',textContent:'',value:'',setAttribute:jest.fn(),addEventListener:jest.fn(),querySelectorAll:()=>[],focus:jest.fn() });
            return elements.get(id);
        };
        const record = {id:1,form_type:formType,blotter_number:'QA-1',incident_type:'Theft',severity:'High',status:'Open',patrol_override:'auto',cart_score:80,
            reporter_first:'Incident',reporter_last:'Reporter',reporter_name:'Encoding Staff',reported_by_name:'Blotter Complainant',respondent_name:'Blotter Respondent',
            address:'<img src=x onerror=alert(1)>',patrol_notes:'Saved note',statement:'Hidden statement',cart_decision_path:'Hidden assessment',evidence:[{file_path:'test.png'}]};
        const context = { console,document:{addEventListener:jest.fn()},mapEl:element,isAdmin:()=>admin,allIncidentsData:[record],mapThresholds:{level2:34,level3:67},
            apiFetch:jest.fn(async()=>({ok:true,json:async()=>record})),escapeHTML:value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),
            window:{HeatmapAnalytics:{getSeverityLabel:()=> 'High'}},ensureFileToken:jest.fn() };
        vm.createContext(context); vm.runInContext(fs.readFileSync(path.join(__dirname,'../../frontend/record-map-panel.js'),'utf8'),context);
        return {context,element};
    }
    test('incidents show reporter information, not blotter parties or removed sections',async()=>{
        const {context,element}=panel('crime'); await context.showMapRecord(1);
        const html=element('mapRecordDetail').innerHTML;
        expect(html).toContain('Incident Reporter'); expect(html).toContain('Encoded by'); expect(html).toContain('Encoding Staff');
        for(const text of ['Complainant','Respondent','CART assessment details','Statement and evidence','Hidden statement','Hidden assessment','mapEvidenceList']) expect(html).not.toContain(text);
        expect(html).toContain('CART score'); expect(html).toContain('&lt;img'); expect(html).not.toContain('<img');
        expect(html).toContain('maxlength="200"'); expect(html).toContain('fieldset');
        expect(context.ensureFileToken).not.toHaveBeenCalled();
    });
    test('blotters show parties and retain patrol editing actions for the executive officer',async()=>{
        const {context,element}=panel('blotter'); await context.showMapRecord(1);
        expect(element('mapRecordDetail').innerHTML).toContain('Blotter Complainant');
        expect(element('mapRecordDetail').innerHTML).toContain('Blotter Respondent');
        expect(element('mapRecordDetail').innerHTML).not.toContain('Reporter information');
        expect(element('mapRecordForm').addEventListener).toHaveBeenCalledWith('submit',context.saveMapRecord);
        expect(element('mapAddress').readOnly).toBe(true);
    });
    test('non-editors retain disabled controls and hidden actions',async()=>{
        const {context,element}=panel('crime',false); await context.showMapRecord(1);
        const html=element('mapRecordDetail').innerHTML;
        expect(html).toContain('id="mapNotes" disabled'); expect(html).toContain('class="record-map-actions" hidden');
    });
    test('popup uses shared light design tokens and the redundant page-level browser is absent',()=>{
        const css=fs.readFileSync(path.join(__dirname,'../../frontend/record-map.css'),'utf8');
        expect(css).toContain('background: var(--bg-card)'); expect(css).toContain('color: var(--text-primary)');
        expect(css).not.toContain('#142138'); expect(css).not.toContain('#0f1b2e');
        const html=fs.readFileSync(path.join(__dirname,'../../frontend/grid-heatmap.html'),'utf8');
        expect(html).not.toContain('id="mapRecordList"');
        expect(html).toMatch(/id="mapRecordListbox"[^>]+role="listbox"/);
    });
});
