// Live, client-side filtering of CART-generated recommendations only.
// The underlying recommendation calculation and schedule records are untouched.
document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('patrolRecommendationSearch');
    const container = document.getElementById('recommendationsContainer');
    const count = document.getElementById('patrolSearchCount');
    if (!input || !container) return;

    function filter() {
        const terms = input.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
        let visible = 0;
        [...container.children].forEach(card => {
            const content = (card.textContent || '').toLocaleLowerCase();
            const matches = terms.every(term => content.includes(term));
            card.hidden = !matches;
            card.style.display = matches ? '' : 'none';
            if (matches && card.classList.contains('rec-card')) visible++;
        });
        if (count) count.textContent = `${visible} recommendation${visible === 1 ? '' : 's'} shown`;
        const options = [...container.querySelectorAll('[role="option"]')].filter(option=>!option.hidden);
        const selected = options.find(option=>option.getAttribute('aria-selected') === 'true') || options[0];
        options.forEach(option=>{option.tabIndex = option === selected ? 0 : -1;});
    }
    input.addEventListener('input', filter);
    new MutationObserver(filter).observe(container, { childList: true });
    filter();
});
