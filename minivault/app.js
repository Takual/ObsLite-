(function () {
    'use strict';

    const STORAGE_KEY = 'minivault_notes';
    const INIT_KEY = 'minivault_initialized';
    const DEFAULT_NOTE = 'home';

    const DEFAULT_NOTES = {
        'home': null,
        'beispiel-notiz': null,
        'zweite-notiz': null
    };

    let notes = {};
    let currentNote = null;
    let editMode = false;
    let currentPanel = 'notes';

    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    // --- Storage ---

    function saveNotes() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
    }

    function loadNotes() {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            notes = JSON.parse(stored);
        }
    }

    // --- Init ---

    async function init() {
        loadNotes();

        if (!localStorage.getItem(INIT_KEY)) {
            await loadDefaultNotes();
            localStorage.setItem(INIT_KEY, '1');
        }

        handleSharedContent();
        renderNoteList();
        navigateTo(getHashNote() || DEFAULT_NOTE);
        setupEventListeners();
        registerServiceWorker();
    }

    async function loadDefaultNotes() {
        for (const name of Object.keys(DEFAULT_NOTES)) {
            if (notes[name]) continue;
            try {
                const resp = await fetch('vault/' + name + '.md');
                if (resp.ok) {
                    notes[name] = await resp.text();
                }
            } catch (e) {
                notes[name] = '# ' + name + '\n\nNeue Notiz.';
            }
        }
        saveNotes();
    }

    function registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('./sw.js');
        }
    }

    // --- Share Target ---

    function handleSharedContent() {
        const params = new URLSearchParams(window.location.search);
        const sharedTitle = params.get('shared_title') || '';
        const sharedText = params.get('shared_text') || '';
        const sharedUrl = params.get('shared_url') || '';

        if (!sharedTitle && !sharedText && !sharedUrl) return;

        const title = sharedTitle || extractTitle(sharedText) || extractTitle(sharedUrl) || 'geteilter-inhalt';
        const slug = slugify(title) || 'geteilter-inhalt-' + Date.now();

        let content = '# ' + title + '\n\n';
        content += '*Gespeichert am ' + new Date().toLocaleDateString('de-DE') + '*\n\n';

        if (sharedUrl) {
            content += '**Link:** ' + sharedUrl + '\n\n';
        }
        if (sharedText && sharedText !== sharedUrl) {
            content += sharedText + '\n';
        }

        const noteName = findUniqueSlug(slug);
        notes[noteName] = content;
        saveNotes();

        window.history.replaceState({}, '', window.location.pathname + '#' + noteName);
        showToast('Notiz "' + noteName + '" erstellt');

        currentNote = noteName;
    }

    function extractTitle(text) {
        if (!text) return '';
        try {
            const url = new URL(text);
            return url.hostname.replace('www.', '') + url.pathname.slice(0, 30);
        } catch (e) {
            return text.slice(0, 40).replace(/[^a-zA-Z0-9äöüÄÖÜß\s-]/g, '').trim();
        }
    }

    function findUniqueSlug(slug) {
        if (!notes[slug]) return slug;
        let i = 2;
        while (notes[slug + '-' + i]) i++;
        return slug + '-' + i;
    }

    // --- Quick Add (Clipboard / manual URL) ---

    function quickAddFromClipboard() {
        if (navigator.clipboard && navigator.clipboard.readText) {
            navigator.clipboard.readText().then(text => {
                if (text && text.trim()) {
                    quickAddContent(text.trim());
                } else {
                    showNewNoteModal();
                }
            }).catch(() => {
                showNewNoteModal();
            });
        } else {
            showNewNoteModal();
        }
    }

    function quickAddContent(text) {
        let title, content;

        try {
            const url = new URL(text);
            title = url.hostname.replace('www.', '');
            content = '# ' + title + '\n\n';
            content += '*Gespeichert am ' + new Date().toLocaleDateString('de-DE') + '*\n\n';
            content += '**Link:** ' + text + '\n';
        } catch (e) {
            title = text.slice(0, 40).replace(/[^a-zA-Z0-9äöüÄÖÜß\s-]/g, '').trim() || 'notiz';
            content = '# ' + title + '\n\n' + text + '\n';
        }

        const slug = findUniqueSlug(slugify(title) || 'notiz-' + Date.now());
        notes[slug] = content;
        saveNotes();
        renderNoteList();
        navigateTo(slug);
        showToast('Notiz "' + slug + '" erstellt');
    }

    // --- Panel Navigation ---

    function showPanel(name) {
        currentPanel = name;
        $$('.panel').forEach(p => p.classList.remove('active'));
        $('#panel-' + name).classList.add('active');

        $$('#bottom-nav button').forEach(b => b.classList.remove('active'));
        const navBtn = $('#nav-' + name);
        if (navBtn) navBtn.classList.add('active');

        if (name === 'view' || name === 'edit') {
            updateTopBar();
        }
    }

    function updateTopBar() {
        if (!currentNote) return;
        $('.note-title').textContent = currentNote;
        const editBtn = $('#btn-edit-mobile');
        if (editBtn) {
            editBtn.textContent = editMode ? '✓' : '✎';
            editBtn.classList.toggle('active', editMode);
        }
    }

    // --- Rendering ---

    function renderNoteList(filter) {
        const list = $('#note-list');
        const sorted = Object.keys(notes).sort((a, b) => {
            if (a === 'home') return -1;
            if (b === 'home') return 1;
            return a.localeCompare(b);
        });

        list.innerHTML = '';
        for (const name of sorted) {
            if (filter && !name.toLowerCase().includes(filter.toLowerCase())) continue;
            const div = document.createElement('div');
            div.className = 'note-item' + (name === currentNote ? ' active' : '');

            const span = document.createElement('span');
            span.className = 'note-item-name';
            span.textContent = name;
            div.appendChild(span);

            div.onclick = () => {
                navigateTo(name);
                showPanel('view');
            };

            if (name !== 'home') {
                const del = document.createElement('button');
                del.className = 'delete-btn';
                del.textContent = '×';
                del.onclick = (e) => {
                    e.stopPropagation();
                    deleteNote(name);
                };
                div.appendChild(del);
            }

            list.appendChild(div);
        }
    }

    function renderNote() {
        if (!currentNote || !notes[currentNote]) return;

        const content = notes[currentNote];
        updateTopBar();

        // Desktop toolbar
        const dtTitle = $('#desktop-note-title');
        if (dtTitle) dtTitle.textContent = currentNote;
        const dtEdit = $('#btn-edit-desktop');
        if (dtEdit) {
            dtEdit.textContent = editMode ? 'Ansicht' : 'Bearbeiten';
            dtEdit.classList.toggle('active', editMode);
        }

        // Viewer
        $('#viewer').innerHTML = renderMarkdown(content);
        bindWikilinks();

        // Editor
        const textarea = $('#panel-edit textarea');
        if (textarea) textarea.value = content;

        // Desktop: toggle view/edit panels
        if (window.innerWidth >= 768) {
            if (editMode) {
                $('#panel-view').classList.add('has-editor');
                $('#panel-edit').classList.add('active');
            } else {
                $('#panel-view').classList.remove('has-editor');
                $('#panel-edit').classList.remove('active');
            }
        }

        renderBacklinks();
    }

    function renderMarkdown(text) {
        const wikilinkPlaceholders = [];
        const processed = text.replace(/\[\[([^\]]+)\]\]/g, (match, name) => {
            const slug = slugify(name);
            const exists = notes.hasOwnProperty(slug);
            const placeholder = '\x00WL' + wikilinkPlaceholders.length + '\x00';
            wikilinkPlaceholders.push(
                '<a class="wikilink' + (exists ? '' : ' broken') + '" data-note="' + slug + '">' + name + '</a>'
            );
            return placeholder;
        });

        let html = marked.parse(processed);

        wikilinkPlaceholders.forEach((replacement, i) => {
            html = html.replace('\x00WL' + i + '\x00', replacement);
        });

        return html;
    }

    function bindWikilinks() {
        $$('.wikilink').forEach(el => {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                const target = el.dataset.note;
                if (!notes[target]) {
                    notes[target] = '# ' + target + '\n\nNeue Notiz.';
                    saveNotes();
                    renderNoteList();
                }
                navigateTo(target);
                showPanel('view');
            });
        });
    }

    function renderBacklinks() {
        const list = $('#backlinks-list');
        list.innerHTML = '';

        if (!currentNote) return;

        const pattern = '[[' + currentNote + ']]';
        for (const [name, content] of Object.entries(notes)) {
            if (name === currentNote) continue;
            if (content && content.includes(pattern)) {
                const div = document.createElement('div');
                div.className = 'backlink-item';

                const title = document.createElement('div');
                title.textContent = name;
                div.appendChild(title);

                const idx = content.indexOf(pattern);
                const start = Math.max(0, idx - 40);
                const end = Math.min(content.length, idx + pattern.length + 40);
                const ctx = document.createElement('div');
                ctx.className = 'backlink-context';
                ctx.textContent = '...' + content.slice(start, end).replace(/\n/g, ' ') + '...';
                div.appendChild(ctx);

                div.onclick = () => {
                    navigateTo(name);
                    showPanel('view');
                };
                list.appendChild(div);
            }
        }

        if (!list.children.length) {
            list.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:0.9rem;">Keine Backlinks</div>';
        }
    }

    // --- Navigation ---

    function getHashNote() {
        const hash = location.hash.slice(1);
        return hash || null;
    }

    function navigateTo(name) {
        if (editMode) saveCurrentEdit();
        editMode = false;
        currentNote = name;
        location.hash = name;
        renderNoteList();
        renderNote();
    }

    // --- Edit ---

    function toggleEdit() {
        if (editMode) {
            saveCurrentEdit();
            editMode = false;
            if (window.innerWidth < 768) {
                showPanel('view');
            }
        } else {
            editMode = true;
            if (window.innerWidth < 768) {
                showPanel('edit');
            }
        }
        renderNote();
    }

    function saveCurrentEdit() {
        if (!currentNote) return;
        const textarea = $('#panel-edit textarea');
        if (textarea) {
            notes[currentNote] = textarea.value;
            saveNotes();
        }
    }

    // --- Note Management ---

    function showNewNoteModal() {
        $('#new-note-modal').classList.add('visible');
        const input = $('#new-note-name');
        input.value = '';
        setTimeout(() => input.focus(), 100);
    }

    function confirmCreateNote() {
        const input = $('#new-note-name');
        const name = slugify(input.value.trim());
        if (!name) return;
        if (notes[name]) {
            navigateTo(name);
        } else {
            notes[name] = '# ' + input.value.trim() + '\n\nNeue Notiz.';
            saveNotes();
            renderNoteList();
            navigateTo(name);
        }
        $('#new-note-modal').classList.remove('visible');
        showPanel('view');
    }

    function deleteNote(name) {
        if (!confirm('Notiz "' + name + '" wirklich löschen?')) return;
        delete notes[name];
        saveNotes();
        if (currentNote === name) {
            navigateTo(DEFAULT_NOTE);
        }
        renderNoteList();
    }

    function exportZip() {
        const zip = new JSZip();
        for (const [name, content] of Object.entries(notes)) {
            zip.file(name + '.md', content);
        }
        zip.generateAsync({ type: 'blob' }).then(blob => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'minivault-export.zip';
            a.click();
            URL.revokeObjectURL(a.href);
        });
    }

    // --- Toast ---

    function showToast(msg) {
        const toast = $('#toast');
        toast.textContent = msg;
        toast.classList.add('visible');
        setTimeout(() => toast.classList.remove('visible'), 2500);
    }

    // --- Graph ---

    function showGraph() {
        $('#graph-overlay').style.display = 'block';
        renderGraph();
    }

    function hideGraph() {
        $('#graph-overlay').style.display = 'none';
        const svg = $('#graph-container svg');
        if (svg) svg.remove();
    }

    function renderGraph() {
        const container = $('#graph-container');
        const width = container.clientWidth;
        const height = container.clientHeight;

        const nodeNames = Object.keys(notes);
        const nodeMap = {};
        const nodes = nodeNames.map((name, i) => {
            const node = { id: name, index: i };
            nodeMap[name] = node;
            return node;
        });

        const links = [];
        const seen = new Set();
        for (const [name, content] of Object.entries(notes)) {
            if (!content) continue;
            const matches = content.match(/\[\[([^\]]+)\]\]/g) || [];
            for (const m of matches) {
                const target = slugify(m.slice(2, -2));
                if (nodeMap[target] && name !== target) {
                    const key = [name, target].sort().join('|');
                    if (!seen.has(key)) {
                        seen.add(key);
                        links.push({ source: nodeMap[name], target: nodeMap[target] });
                    }
                }
            }
        }

        const svg = d3.select(container).append('svg')
            .attr('width', width)
            .attr('height', height);

        const simulation = d3.forceSimulation(nodes)
            .force('link', d3.forceLink(links).distance(100))
            .force('charge', d3.forceManyBody().strength(-200))
            .force('center', d3.forceCenter(width / 2, height / 2))
            .force('collision', d3.forceCollide().radius(35));

        const link = svg.append('g')
            .selectAll('line')
            .data(links)
            .join('line')
            .attr('stroke', '#2a2a4a')
            .attr('stroke-width', 1.5);

        const node = svg.append('g')
            .selectAll('g')
            .data(nodes)
            .join('g')
            .style('cursor', 'pointer')
            .call(d3.drag()
                .on('start', (event, d) => {
                    if (!event.active) simulation.alphaTarget(0.3).restart();
                    d.fx = d.x;
                    d.fy = d.y;
                })
                .on('drag', (event, d) => {
                    d.fx = event.x;
                    d.fy = event.y;
                })
                .on('end', (event, d) => {
                    if (!event.active) simulation.alphaTarget(0);
                    d.fx = null;
                    d.fy = null;
                }));

        node.append('circle')
            .attr('r', d => d.id === currentNote ? 10 : 7)
            .attr('fill', d => d.id === currentNote ? '#e94560' : '#53a8e2');

        node.append('text')
            .text(d => d.id)
            .attr('dx', 14)
            .attr('dy', 4)
            .attr('fill', '#a0a0b0')
            .attr('font-size', '12px');

        node.on('click', (event, d) => {
            hideGraph();
            navigateTo(d.id);
            showPanel('view');
        });

        simulation.on('tick', () => {
            link
                .attr('x1', d => d.source.x)
                .attr('y1', d => d.source.y)
                .attr('x2', d => d.target.x)
                .attr('y2', d => d.target.y);
            node.attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');
        });
    }

    // --- Utilities ---

    function slugify(text) {
        return text.toLowerCase().trim()
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9äöüß\-]/g, '');
    }

    // --- Events ---

    function setupEventListeners() {
        // Bottom nav
        $('#nav-notes').onclick = () => showPanel('notes');
        $('#nav-view').onclick = () => showPanel('view');
        $('#nav-backlinks').onclick = () => showPanel('backlinks');
        $('#nav-graph').onclick = showGraph;

        // Top bar
        $('#btn-edit-mobile').onclick = toggleEdit;

        // Sidebar actions
        $('#btn-new').onclick = showNewNoteModal;
        $('#btn-add-clip').onclick = quickAddFromClipboard;
        $('#btn-export').onclick = exportZip;

        // Search
        $('#search-box').oninput = (e) => renderNoteList(e.target.value);

        // Modal
        $('#btn-create-confirm').onclick = confirmCreateNote;
        $('#btn-create-cancel').onclick = () => $('#new-note-modal').classList.remove('visible');
        $('#new-note-name').onkeydown = (e) => {
            if (e.key === 'Enter') confirmCreateNote();
            if (e.key === 'Escape') $('#new-note-modal').classList.remove('visible');
        };

        // Graph
        $('#graph-close').onclick = hideGraph;

        // Desktop toolbar
        const dtEdit = $('#btn-edit-desktop');
        if (dtEdit) dtEdit.onclick = toggleEdit;
        const dtGraph = $('#btn-graph-desktop');
        if (dtGraph) dtGraph.onclick = showGraph;

        // Hash navigation
        window.addEventListener('hashchange', () => {
            const name = getHashNote();
            if (name && name !== currentNote) navigateTo(name);
        });

        // Keyboard
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'e') {
                e.preventDefault();
                toggleEdit();
            }
            if (e.key === 'Escape') {
                if ($('#graph-overlay').style.display === 'block') hideGraph();
                if ($('#new-note-modal').classList.contains('visible')) {
                    $('#new-note-modal').classList.remove('visible');
                }
            }
        });

        // Auto-save editor on panel switch
        $('#panel-edit textarea').addEventListener('input', () => {
            if (currentNote) {
                notes[currentNote] = $('#panel-edit textarea').value;
                saveNotes();
            }
        });
    }

    // --- Start ---

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
