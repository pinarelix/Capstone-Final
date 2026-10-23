document.addEventListener('DOMContentLoaded', async () => {
    const form = document.getElementById('mediationAssignForm');
    const panel = document.getElementById('mediationAssignPanel');
    if (!form || !panel) return;

    const user = getCurrentUser();
    if (!user || !['Executive Officer', 'Team Leader'].includes(user.role)) {
        panel.hidden = true;
        return;
    }

    const select = form.elements.assigned_user_id;
    const scheduledAt = form.elements.scheduled_at;
    const message = document.getElementById('mediationAssignMessage');
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    scheduledAt.min = now.toISOString().slice(0, 16);

    try {
        const response = await apiFetch('/users-list');
        if (!response.ok) throw new Error('Unable to load users');

        const data = await response.json();
        const users = Array.isArray(data) ? data : (data.users || []);
        users.forEach(activeUser => {
            const option = document.createElement('option');
            option.value = activeUser.id;
            option.textContent = activeUser.name;
            select.appendChild(option);
        });
    } catch (error) {
        message.textContent = error.message;
    }

    form.addEventListener('submit', async event => {
        event.preventDefault();
        message.textContent = 'Saving…';
        const data = Object.fromEntries(new FormData(form));

        try {
            const response = await apiFetch('/mediation-tasks', {
                method: 'POST',
                body: JSON.stringify(data)
            });
            if (!response.ok) {
                const body = await response.json().catch(() => ({}));
                throw new Error(body.error || 'Unable to schedule');
            }
            message.textContent = 'Mediation appointment assigned.';
            form.reset();
        } catch (error) {
            message.textContent = error.message;
        }
    });
});
