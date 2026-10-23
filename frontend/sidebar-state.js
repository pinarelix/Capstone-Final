// Runs in <head>, before the first sidebar paint on every application page.
// The application still uses separate HTML pages; this keeps the navigation
// rail visually stable while those pages navigate normally.
(function sidebarState() {
    const pages = ['dashboard.html','incident.html','incident-view.html','grid-heatmap.html','patrol.html','report.html','users.html','settings.html'];
    let user;
    try { user = JSON.parse(sessionStorage.getItem('user') || 'null'); } catch { user = null; }
    const key = user?.id ? 'brgy179.navigation.v1:' + user.id : null;
    const root = document.documentElement;
    let cache = { order: [], fetchedAt: 0 };
    try {
        if (localStorage.getItem('sidebarCollapsed') === 'true') root.dataset.sidebarCollapsed = 'true';
        const saved = key ? JSON.parse(localStorage.getItem(key) || 'null') : null;
        if (saved && Array.isArray(saved.order) && new Set(saved.order).size === saved.order.length
            && saved.order.every(page => pages.includes(page))) cache = saved;
    } catch { /* Storage may be disabled; use the default visible order. */ }
    if (user?.role) root.dataset.sidebarRole = user.role === 'Deputy Officer' ? 'Executive Officer' : user.role;
    function earlyOrder() {
        const old = document.getElementById('sidebar-order-prepaint');
        if (old) old.remove();
        if (!cache.order.length) return;
        const style = document.createElement('style'); style.id = 'sidebar-order-prepaint';
        style.textContent = cache.order.map((page, rank) => '.sidebar-nav>a.nav-item[href="' + page + '"]{order:' + rank + '}').join('');
        document.head.append(style);
    }
    earlyOrder();
    window.SidebarState = {
        read: () => cache,
        needsRefresh: () => Boolean(key) && (!cache.fetchedAt || Date.now() - cache.fetchedAt > 300000),
        save(order) {
            if (!Array.isArray(order) || order.some(page => !pages.includes(page)) || new Set(order).size !== order.length) return;
            cache = { order: order.slice(), fetchedAt: Date.now() };
            try { if (key) localStorage.setItem(key, JSON.stringify(cache)); } catch { /* In-memory state still works. */ }
        },
        apply(nav, order) {
            const items = [...nav.querySelectorAll('a.nav-item[href]')];
            const page = item => item.getAttribute('href').split('?')[0];
            const fallback = items.map(page);
            const rank = item => order.includes(page(item)) ? order.indexOf(page(item)) : order.length + fallback.indexOf(page(item));
            const sorted = items.slice().sort((a,b) => rank(a) - rank(b));
            sorted.forEach((item,index) => { if (nav.children[index] !== item) nav.insertBefore(item, nav.children[index] || null); });
            document.getElementById('sidebar-order-prepaint')?.remove();
        }
    };
})();
