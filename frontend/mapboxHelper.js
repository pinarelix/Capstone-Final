/* ============================================================
   MAPBOX HELPER - Barangay 179 Crime BI
   Token-free MapLibre GL setup for the Risk Map page. Separate from the
   Leaflet-based mapHelper.js used by the incident form.
============================================================ */

const MB_CENTER = window.BarangayGeometry.center;
const MB_BOUNDARY = window.BarangayGeometry.boundary;
const MB_BOUNDS = window.BarangayGeometry.bounds;

function createMapboxMap(container) {
    if (typeof maplibregl === 'undefined') throw new Error('The bundled map renderer could not load. Restart the app after updating.');
    if (!maplibregl.supported()) throw new Error('WebGL is unavailable. Enable graphics acceleration to display the map.');

    const map = new maplibregl.Map({
        container: container,
        style: {
            version: 8,
            // Solid background remains usable while raster tiles load.
            sources: { basemap: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256,
                attribution: '© OpenStreetMap contributors' } },
            layers: [{ id: 'map-background', type: 'background', paint: { 'background-color': '#e2e8f0' } },
                { id: 'basemap', type: 'raster', source: 'basemap' }]
        },
        center: MB_CENTER,
        zoom: 15,
        minZoom: 13,
        maxZoom: 19,
        maxBounds: MB_BOUNDS,
        attributionControl: false
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

    map.on('style.load', () => {
        map.addSource('boundary-mask', {
            type: 'geojson',
            data: {
                type: 'Feature',
                geometry: {
                    type: 'Polygon',
                    coordinates: [
                        [[-180, -90], [180, -90], [180, 90], [-180, 90], [-180, -90]],
                        MB_BOUNDARY
                    ]
                }
            }
        });

        map.addLayer({
            id: 'boundary-mask-fill',
            type: 'fill',
            source: 'boundary-mask',
            paint: {
                'fill-color': '#94a3b8',
                'fill-opacity': 0.45
            }
        });

        map.addSource('boundary-outline', {
            type: 'geojson',
            data: {
                type: 'Feature',
                geometry: {
                    type: 'Polygon',
                    coordinates: [MB_BOUNDARY]
                }
            }
        });

        map.addLayer({
            id: 'boundary-glow',
            type: 'line',
            source: 'boundary-outline',
            paint: {
                'line-color': '#1e40af',
                'line-width': 6,
                'line-opacity': 0.3,
                'line-blur': 4
            }
        });

        map.addLayer({
            id: 'boundary-line',
            type: 'line',
            source: 'boundary-outline',
            paint: {
                'line-color': '#1e293b',
                'line-width': 2,
                'line-opacity': 0.8
            }
        });
    });

    return map;
}
