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
