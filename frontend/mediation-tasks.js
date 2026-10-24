document.addEventListener('DOMContentLoaded', () => {
    const list = document.getElementById('mediationTaskList');
    if (!list) return;

    const dialog = document.getElementById('mediationTaskDialog');
    const form = document.getElementById('mediationTaskForm');
    const status = document.getElementById('mediationTaskStatus');
    const newDate = document.getElementById('mediationNewDate');
    const newDateWrap = document.getElementById('mediationNewDateWrap');
    const errorMessage = document.getElementById('mediationTaskError');
    let currentTask = null;

    const assignDialog = document.getElementById('mediationAssignDialog');
    const assignForm = document.getElementById('dashboardMediationAssignForm');
    const assignButton = document.getElementById('openMediationAssign');
    const blotterSearch = document.getElementById('mediationBlotterSearch');
    const blotterSelect = document.getElementById('mediationBlotterSelect');
    const kagawadSelect = document.getElementById('mediationKagawadSelect');
    const assignDate = document.getElementById('mediationAssignDate');
    const assignMessage = document.getElementById('mediationAssignDashboardMessage');
    const currentUser = getCurrentUser();

    async function loadBlotterChoices(search = '') {
        if (!blotterSelect) return;
        const selected = blotterSelect.value;
        blotterSelect.innerHTML = '<option value="">Loading blotter records...</option>';
        const response = await apiFetch('/incidents?' + new URLSearchParams({
            page: 1,
            limit: 10,
            form_type: 'blotter',
            ...(search ? { search } : {})
        }));
        if (!response.ok) throw new Error('Unable to load blotter records');
        const data = await response.json();
        const rows = Array.isArray(data) ? data : (data.incidents || []);
        blotterSelect.innerHTML = '<option value="">Choose a blotter record</option>';
        rows.forEach(record => {
            const option = document.createElement('option');
            option.value = record.id;
            option.textContent = `${record.blotter_number || `Blotter #${record.id}`} · ${record.incident_type || 'Unclassified'} · ${record.street_name || 'No location'}`;
            blotterSelect.appendChild(option);
        });
        if (selected && [...blotterSelect.options].some(option => option.value === selected)) blotterSelect.value = selected;
    }

    async function loadKagawadChoices() {
        if (!kagawadSelect) return;
        const response = await apiFetch('/users-list?role=Kagawad');
        if (!response.ok) throw new Error('Unable to load Kagawad accounts');
        const rows = await response.json();
        kagawadSelect.innerHTML = '<option value="">Choose a Kagawad</option>';
        rows.forEach(user => kagawadSelect.add(new Option(user.name, String(user.id))));
    }

    if (assignDialog && assignForm && currentUser?.role === 'Executive Officer') {
        assignButton.hidden = false;
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        assignDate.min = now.toISOString().slice(0, 16);

        assignButton.addEventListener('click', async () => {
            assignMessage.textContent = '';
            assignDialog.showModal();
            try {
                await Promise.all([loadBlotterChoices(), loadKagawadChoices()]);
            } catch (error) {
                assignMessage.textContent = error.message;
            }
        });
        document.getElementById('closeMediationAssign').addEventListener('click', () => assignDialog.close());
        document.getElementById('cancelMediationAssign').addEventListener('click', () => assignDialog.close());

        let blotterSearchDelay;
        blotterSearch.addEventListener('input', () => {
            clearTimeout(blotterSearchDelay);
            blotterSearchDelay = setTimeout(() => loadBlotterChoices(blotterSearch.value.trim()).catch(error => {
                assignMessage.textContent = error.message;
            }), 250);
        });

        assignForm.addEventListener('submit', async event => {
            event.preventDefault();
            assignMessage.textContent = 'Scheduling mediation...';
            try {
                const response = await apiFetch('/mediation-tasks', {
                    method: 'POST',
                    body: JSON.stringify(Object.fromEntries(new FormData(assignForm)))
                });
                if (!response.ok) {
                    const body = await response.json().catch(() => ({}));
                    throw new Error(body.error || 'Unable to schedule mediation');
                }
                assignMessage.textContent = 'Mediation appointment assigned.';
                assignForm.reset();
                assignDate.min = now.toISOString().slice(0, 16);
            } catch (error) {
                assignMessage.textContent = error.message;
            }
        });
    }

    function syncRescheduleField() {
        const isRescheduled = status.value === 'Rescheduled';
        newDateWrap.hidden = !isRescheduled;
        newDate.required = isRescheduled;
    }

    status.addEventListener('change', syncRescheduleField);
    document.getElementById('mediationClose').addEventListener('click', () => dialog.close());

    async function loadTasks() {
        try {
            const response = await apiFetch('/me/mediation-tasks');
            if (!response.ok) throw new Error('Unable to retrieve tasks');

            const tasks = await response.json();
            list.replaceChildren();
            if (tasks.length === 0) {
                list.textContent = 'No blotter mediation appointments assigned to you today.';
                return;
            }

            tasks.forEach(task => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'task-row';

                const description = document.createElement('span');
                description.textContent = `${task.blotter_number || `Blotter #${task.incident_id}`} · ${task.incident_type} · ${task.priority || 'Normal'}`;

                const appointment = document.createElement('span');
                const time = new Date(task.scheduled_at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit'
                });
                appointment.textContent = `${time} · ${task.status}`;

                button.append(description, appointment);
                button.addEventListener('click', () => openTask(task));
                list.appendChild(button);
            });
        } catch (error) {
            list.textContent = error.message;
        }
    }

    async function openTask(task) {
        currentTask = task;
        document.getElementById('mediationTaskHeading').textContent =
            `${task.blotter_number || task.incident_id} — ${task.incident_type}`;
        status.value = task.status;
        newDate.value = '';
        document.getElementById('mediationTaskNote').value = '';
        errorMessage.textContent = '';
        syncRescheduleField();

        const history = document.getElementById('mediationTaskHistory');
        history.textContent = 'Loading…';
        dialog.showModal();

        try {
            const response = await apiFetch(`/me/mediation-tasks/${task.id}/history`);
            if (!response.ok) throw new Error('History unavailable');

            const rows = await response.json();
            history.replaceChildren();
            if (rows.length === 0) history.textContent = 'No previous updates.';

            rows.forEach(row => {
                const entry = document.createElement('p');
                const note = row.note ? ` — ${row.note}` : '';
                entry.textContent = `${new Date(row.created_at).toLocaleString()} · ${row.author} · ${row.status}${note}`;
                history.appendChild(entry);
            });
        } catch (error) {
            history.textContent = error.message;
        }
    }

    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (!currentTask) return;

        errorMessage.textContent = '';
        try {
            const response = await apiFetch(`/me/mediation-tasks/${currentTask.id}`, {
                method: 'PATCH',
                body: JSON.stringify({
                    status: status.value,
                    note: document.getElementById('mediationTaskNote').value,
                    scheduled_at: newDate.value
                })
            });
            if (!response.ok) {
                const body = await response.json().catch(() => ({}));
                throw new Error(body.error || 'Update failed');
            }

            currentTask = null;
            dialog.close();
            await loadTasks();
        } catch (error) {
            errorMessage.textContent = error.message;
        }
    });

    loadTasks();
});
