/* ============================================================
   MAP HELPER - Barangay 179 Crime BI
   Shared Leaflet setup for the barangay boundary map, used by
   incident.js (location picker + its expand modal) and
   grid-heatmap.js (risk map). Single source of truth for the
   boundary coordinates and the tile/mask/outline layers that were
   previously copy-pasted in all three places.
============================================================ */

const BARANGAY_CENTER = [14.7468, 121.0789];

const BARANGAY_BOUNDARY_COORDS = [
    [14.759055, 121.068181],
    [14.758775, 121.081208],
    [14.754012, 121.081317],
    [14.753785, 121.084781],
    [14.751778, 121.084528],
    [14.749692, 121.083159],
    [14.749858, 121.081282],
    [14.746963, 121.081271],
    [14.745345, 121.078353],
    [14.742305, 121.077591],
    [14.740230, 121.075112],
    [14.741330, 121.073074],
    [14.740354, 121.072044],
    [14.740365, 121.068793],
    [14.739151, 121.068825],
    [14.739182, 121.067227],
    [14.758127, 121.067320],
    [14.758158, 121.067813]
];

/**
 * Create a Leaflet map clipped to the Barangay 179 boundary: OSM tiles,
 * a dark mask over everything outside the boundary, and a highlighted
 * boundary outline. maxBounds/maxBoundsViscosity are always derived
 * from the boundary and can't be overridden.
 *
 * @param {string|HTMLElement} container - map container id or element
 * @param {Object} [mapOptions] - extra L.map() options (center, zoom,
 *   zoomControl, minZoom, maxZoom, etc.), merged over shared defaults
 * @returns {{ map: L.Map, bounds: L.LatLngBounds, boundaryLayer: L.Polygon }}
 */
function createBarangayMap(container, mapOptions = {}) {
    const latLngs = BARANGAY_BOUNDARY_COORDS.map(coord => L.latLng(coord[0], coord[1]));
    const bounds = L.latLngBounds(latLngs);

    const map = L.map(container, {
        center: BARANGAY_CENTER,
        zoom: 16,
        ...mapOptions,
        maxBounds: bounds,
        maxBoundsViscosity: 1.0
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    const outerMaskCoords = [
        [90, -180], [90, 180], [-90, 180], [-90, -180], [90, -180]
    ];
    const holeCoords = BARANGAY_BOUNDARY_COORDS.map(coord => [coord[0], coord[1]]);

    L.polygon([outerMaskCoords, holeCoords], {
        color: "transparent",
        weight: 0,
        fillColor: "rgba(0, 0, 0, 0.65)",
        fillOpacity: 0.65,
        interactive: false,
        className: "blur-mask",
        pane: "overlayPane"
    }).addTo(map);

    const boundaryLayer = L.polygon(BARANGAY_BOUNDARY_COORDS, {
        color: "#111111",
        weight: 4,
        opacity: 1,
        fillColor: "transparent",
        interactive: false
    }).addTo(map);

    L.polygon(BARANGAY_BOUNDARY_COORDS, {
        color: "#0ea5e9",
        weight: 8,
        opacity: 0.15,
        fillColor: "transparent",
        interactive: false,
        className: "boundary-glow"
    }).addTo(map);

    map.fitBounds(bounds, { padding: [40, 40] });

    return { map, bounds, boundaryLayer };
}
