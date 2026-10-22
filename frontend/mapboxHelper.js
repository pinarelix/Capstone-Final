/* ============================================================
   MAPBOX HELPER - Barangay 179 Crime BI
   Mapbox GL JS setup for the Risk Map page. Separate from the
   Leaflet-based mapHelper.js used by the incident form.
============================================================ */

// Paste your Mapbox public access token here.
// Sign up free at https://mapbox.com — 50,000 map loads/month.
const MAPBOX_TOKEN = 'YOUR_MAPBOX_TOKEN_HERE';

const MB_CENTER = [121.0789, 14.7468];

const MB_BOUNDARY = [
    [121.068181, 14.759055],
    [121.081208, 14.758775],
    [121.081317, 14.754012],
    [121.084781, 14.753785],
    [121.084528, 14.751778],
    [121.083159, 14.749692],
    [121.081282, 14.749858],
    [121.081271, 14.746963],
    [121.078353, 14.745345],
    [121.077591, 14.742305],
    [121.075112, 14.740230],
    [121.073074, 14.741330],
    [121.072044, 14.740354],
    [121.068793, 14.740365],
    [121.068825, 14.739151],
    [121.067227, 14.739182],
    [121.067320, 14.758127],
    [121.067813, 14.758158],
    [121.068181, 14.759055]
];

const MB_BOUNDS = (function () {
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    MB_BOUNDARY.forEach(([lng, lat]) => {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
    });
    const pad = 0.003;
    return [[minLng - pad, minLat - pad], [maxLng + pad, maxLat + pad]];
})();

function createMapboxMap(container) {
    mapboxgl.accessToken = MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
        container: container,
        style: 'mapbox://styles/mapbox/light-v11',
        center: MB_CENTER,
        zoom: 15,
        minZoom: 13,
        maxZoom: 19,
        maxBounds: MB_BOUNDS,
        attributionControl: false
    });

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-left');

    map.on('load', () => {
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
