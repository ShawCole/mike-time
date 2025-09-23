import { useState, useMemo, useEffect } from 'react';
import axios from 'axios';
import { API_ENDPOINTS } from '../config/api';

const ReportDisplay = ({ data, onReset }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize] = useState(25);
    // Legacy per-issue list (kept for downloads and compatibility)
    const [issues, setIssues] = useState(data.issues || []);
    const [issuesOffset, setIssuesOffset] = useState(Array.isArray(data.issues) ? data.issues.length : 0);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [changes, setChanges] = useState([]);
    const [isFixingAll, setIsFixingAll] = useState(false);
    const [showChanges, setShowChanges] = useState(false);
    const [overriddenFixes, setOverriddenFixes] = useState({}); // Track overridden fixes by issue ID
    const [editingFixId, setEditingFixId] = useState(null); // Track which fix is being edited
    const [hoveredFixId, setHoveredFixId] = useState(null); // Track which fix is being hovered
    const [newIssueIds, setNewIssueIds] = useState(new Set()); // Track which issues are new/unseen
    const [newIssuesOverridden, setNewIssuesOverridden] = useState(new Set()); // Track new issues that have been overridden
    const [isCheckingNewIssues, setIsCheckingNewIssues] = useState(false);

    // Change override state
    const [hoveredChangeId, setHoveredChangeId] = useState(null); // Track which change is being hovered
    const [editingChangeId, setEditingChangeId] = useState(null); // Track which change is being edited
    const [overriddenChanges, setOverriddenChanges] = useState({}); // Track overridden changes by issue ID
    const [expandedChangeGroups, setExpandedChangeGroups] = useState(new Set());
    const [groupChangeOverriddenFixes, setGroupChangeOverriddenFixes] = useState({}); // key -> overridden value
    const [groupChangeEditingKey, setGroupChangeEditingKey] = useState(null);

    // Bulk override modal state
    const [showBulkOverrideModal, setShowBulkOverrideModal] = useState(false);
    const [bulkOverrideData, setBulkOverrideData] = useState({
        currentIssue: null,
        similarIssues: [],
        originalFix: '',
        overriddenFix: '',
        isOverrideMode: false // Track whether this is an override or just a suggested fix
    });
    // Bulk apply progress
    const [isBulkApplying, setIsBulkApplying] = useState(false);
    const [bulkApplyCompleted, setBulkApplyCompleted] = useState(0);
    const [bulkApplyTotal, setBulkApplyTotal] = useState(0);

    // Fix All overlay state
    const [isFixAllApplying, setIsFixAllApplying] = useState(false);
    const [fixAllCompleted, setFixAllCompleted] = useState(0);
    const [fixAllTotal, setFixAllTotal] = useState(0);

    // Simple exponential backoff with jitter for transient errors (429/503/network)
    const requestWithRetry = async (requestFn, options = {}) => {
        const { retries = 5, baseDelayMs = 800 } = options;
        for (let attempt = 0; attempt <= retries; attempt += 1) {
            try {
                // eslint-disable-next-line no-await-in-loop
                return await requestFn();
            } catch (err) {
                const status = err?.response?.status;
                const isTransient = status === 429 || status === 503 || typeof status === 'undefined';
                if (attempt < retries && isTransient) {
                    const jitter = Math.floor(Math.random() * 300);
                    const delay = baseDelayMs * Math.pow(2, attempt) + jitter;
                    // eslint-disable-next-line no-await-in-loop
                    await new Promise((r) => setTimeout(r, delay));
                    continue;
                }
                throw err;
            }
        }
        // Should never reach here
        // eslint-disable-next-line no-throw-literal
        throw { message: 'Exhausted retries' };
    };

    // Not An Issue modal state
    const [showNotIssueModal, setShowNotIssueModal] = useState(false);
    const [notIssueData, setNotIssueData] = useState({
        currentIssue: null,
        similarIssues: [],
        char: null
    });
    const [isNotIssueApplying, setIsNotIssueApplying] = useState(false);

    // Follow-up modal state for applying to sibling groups
    const [showFollowUpModal, setShowFollowUpModal] = useState(false);
    const [followUpQueue, setFollowUpQueue] = useState([]); // array of groups
    const [followUpAction, setFollowUpAction] = useState('fix'); // 'fix' | 'notAnIssue'
    const [isFollowUpApplying, setIsFollowUpApplying] = useState(false);

    // Grouped mode state (default on)
    const [groups, setGroups] = useState([]);
    const [groupsOffset, setGroupsOffset] = useState(0);
    const [totalGroups, setTotalGroups] = useState(0);
    const [totalGroupIssues, setTotalGroupIssues] = useState(0);
    const [expandedSignatures, setExpandedSignatures] = useState(new Set());
    const [groupRefsCache, setGroupRefsCache] = useState(new Map()); // signature -> { loaded, issueIds, cellRefs }
    const [groupOverriddenFixes, setGroupOverriddenFixes] = useState({}); // signature -> string
    const [groupEditingSignature, setGroupEditingSignature] = useState(null);

    // Find similar cells with same original value and suggested fix
    const findSimilarCells = (currentIssue, fixToApply = null) => {
        const normalize = (s) => (s ?? '').trim();
        const currentOriginalValue = normalize(currentIssue.originalValue);

        const similarIssues = issues.filter(issue =>
            issue.id !== currentIssue.id && // Exclude the current issue
            !issue.fixed && // Only unfixed issues
            normalize(issue.originalValue) === currentOriginalValue && // Same original value (trim-normalized)
            !overriddenFixes[issue.id] // Not already overridden
        );

        return similarIssues;
    };

    // Check for new/unseen issues
    const checkNewIssues = async () => {
        if (!data.sessionId || isCheckingNewIssues) return;

        setIsCheckingNewIssues(true);
        try {
            const response = await axios.post(API_ENDPOINTS.checkNewIssues, {
                sessionId: data.sessionId
            });

            if (response.data.success) {
                setNewIssueIds(new Set(response.data.newIssueIds));
                console.log(`Found ${response.data.newIssueCount} new issues out of ${response.data.totalIssues} total issues`);
            }
        } catch (error) {
            console.error('Error checking for new issues:', error);
            // If we can't check, assume no new issues to avoid false warnings
            setNewIssueIds(new Set());
        } finally {
            setIsCheckingNewIssues(false);
        }
    };

    // Load grouped issues and check for new issues when component loads
    useEffect(() => {
        const loadGroups = async () => {
            try {
                if (!data.sessionId) return;
                const resp = await axios.get(API_ENDPOINTS.getIssuesGrouped(data.sessionId, 0, undefined, true));
                const arr = Array.isArray(resp?.data?.groups) ? resp.data.groups : [];
                if (arr.length === 0) {
                    // Local fallback from preview issues to keep analyzer visible
                    const map = new Map();
                    for (const it of (issues || [])) {
                        if (it.fixed) continue;
                        const errorType = it.hasInvalidChars ? 'invalid_characters' : (it.hasLengthIssues ? 'length_violation' : 'unknown');
                        const signature = `v1|column=${it.column}|type=${errorType}|value=${btoa(unescape(encodeURIComponent(it.originalValue || '')))}`;
                        if (!map.has(signature)) map.set(signature, { signature, column: it.column, errorType, value: it.originalValue, count: 0, affectedCellCount: 0, sampleIssue: it });
                        const g = map.get(signature); g.count += 1; g.affectedCellCount = g.count;
                    }
                    const localGroups = Array.from(map.values());
                    setGroups(localGroups);
                    setGroupsOffset(localGroups.length);
                    setTotalGroups(localGroups.length);
                    setTotalGroupIssues((issues || []).filter(i => !i.fixed).length);
                } else {
                    setGroups(arr);
                    setGroupsOffset(arr.length);
                    if (typeof resp?.data?.totalGroups === 'number') setTotalGroups(resp.data.totalGroups);
                    if (typeof resp?.data?.totalIssues === 'number') setTotalGroupIssues(resp.data.totalIssues);
                }
            } catch (e) {
                console.warn('Failed to load grouped issues (using local fallback):', e);
                const map = new Map();
                for (const it of (issues || [])) {
                    if (it.fixed) continue;
                    const errorType = it.hasInvalidChars ? 'invalid_characters' : (it.hasLengthIssues ? 'length_violation' : 'unknown');
                    const signature = `v1|column=${it.column}|type=${errorType}|value=${btoa(unescape(encodeURIComponent(it.originalValue || '')))}`;
                    if (!map.has(signature)) map.set(signature, { signature, column: it.column, errorType, value: it.originalValue, count: 0, affectedCellCount: 0, sampleIssue: it });
                    const g = map.get(signature); g.count += 1; g.affectedCellCount = g.count;
                }
                const localGroups = Array.from(map.values());
                setGroups(localGroups);
                setGroupsOffset(localGroups.length);
                setTotalGroups(localGroups.length);
                setTotalGroupIssues((issues || []).filter(i => !i.fixed).length);
            }
        };
        loadGroups();
        checkNewIssues();
    }, [data.sessionId]);

    // Auto-fetch next page of issues when we fixed all currently loaded but there are more overall
    useEffect(() => {
        const remainingLoaded = issues.filter(i => !i.fixed).length;
        if (remainingLoaded === 0 && (typeof data.issueCount === 'number') && issues.length < data.issueCount) {
            // load next page automatically
            loadMoreIssues();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [issues, data.issueCount]);

    const loadMoreIssues = async () => {
        if (!data.sessionId) return;
        if (isLoadingMore) return;
        setIsLoadingMore(true);
        try {
            const res = await axios.get(API_ENDPOINTS.getIssuesPage(data.sessionId, issuesOffset, 20000, true));
            if (res.data?.issues?.length) {
                setIssues(prev => [...prev, ...res.data.issues]);
                setIssuesOffset(prev => prev + res.data.issues.length);
            }
        } catch (e) {
            console.warn('Failed to load more issues page:', e);
        } finally {
            setIsLoadingMore(false);
        }
    };

    // Group helpers
    const isGroupExpanded = (signature) => expandedSignatures.has(signature);
    const toggleGroupExpand = async (signature) => {
        setExpandedSignatures(prev => {
            const next = new Set(prev);
            if (next.has(signature)) next.delete(signature); else next.add(signature);
            return next;
        });
        // Lazy load refs if not loaded
        if (!groupRefsCache.get(signature)) {
            try {
                const resp = await axios.get(API_ENDPOINTS.getIssueCellRefs(data.sessionId, signature));
                let issueIds = Array.isArray(resp?.data?.issueIds) ? resp.data.issueIds : [];
                let cellRefs = Array.isArray(resp?.data?.cellRefs) ? resp.data.cellRefs : [];

                // If server returned nothing (likely different instance), fallback to client-derived refs
                if ((issueIds.length === 0 && cellRefs.length === 0)) {
                    // Opportunistic warm-up: try to touch the session endpoint first to pin the instance
                    try { await axios.get(API_ENDPOINTS.getSessionInfo(data.sessionId)); } catch (_) { }
                    const group = groups.find(g => g.signature === signature);
                    // Ensure we have issues to filter; if not, fetch the first page now
                    let sourceIssues = issues;
                    if (!Array.isArray(sourceIssues) || sourceIssues.length === 0) {
                        try {
                            const page = await axios.get(API_ENDPOINTS.getIssuesPage(data.sessionId, 0, 20000, true));
                            const pageIssues = Array.isArray(page?.data?.issues) ? page.data.issues : [];
                            if (pageIssues.length > 0) {
                                setIssues(prev => (prev && prev.length ? prev : pageIssues));
                                sourceIssues = pageIssues;
                            }
                        } catch (_) {
                            // ignore and rely on whatever we have
                        }
                    }
                    const derived = (sourceIssues || [])
                        .filter(i => !i.fixed && i.column === group?.column && i.originalValue === group?.value);
                    issueIds = derived.map(i => i.id);
                    cellRefs = derived.map(i => i.cellReference || `${i.column}${i.row}`);
                }

                setGroupRefsCache(prev => new Map(prev).set(signature, { loaded: true, issueIds, cellRefs }));
            } catch (e) {
                console.warn('Failed to load cell refs for group (fallback to client filter):', e);
                // Fallback: derive cell refs from currently loaded issues
                const group = groups.find(g => g.signature === signature);
                let sourceIssues = issues;
                if (!Array.isArray(sourceIssues) || sourceIssues.length === 0) {
                    try {
                        const page = await axios.get(API_ENDPOINTS.getIssuesPage(data.sessionId, 0, 20000, true));
                        const pageIssues = Array.isArray(page?.data?.issues) ? page.data.issues : [];
                        if (pageIssues.length > 0) {
                            setIssues(prev => (prev && prev.length ? prev : pageIssues));
                            sourceIssues = pageIssues;
                        }
                    } catch (_) { }
                }
                const filtered = (sourceIssues || []).filter(i => !i.fixed && i.column === group?.column && i.originalValue === group?.value);
                const refs = filtered.map(i => i.cellReference || `${i.column}${i.row}`);
                const ids = filtered.map(i => i.id);
                setGroupRefsCache(prev => new Map(prev).set(signature, { loaded: true, issueIds: ids, cellRefs: refs }));
            }
        }
    };

    const copyRefsToClipboard = (signature) => {
        const entry = groupRefsCache.get(signature);
        const text = entry && Array.isArray(entry.cellRefs) ? entry.cellRefs.join(',') : '';
        if (!text) return;
        navigator.clipboard.writeText(text).catch(() => { });
    };

    const removeGroupFromUI = (signature) => {
        setGroups(prev => prev.filter(g => g.signature !== signature));
    };

    const idempotencyKey = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    const applyFixToGroup = async (group, overriddenFix) => {
        const payload = { sessionId: data.sessionId, groupSignature: group.signature, idempotencyKey: idempotencyKey() };
        if (typeof overriddenFix === 'string' && overriddenFix.length > 0) payload.overriddenFix = overriddenFix;
        const resp = await requestWithRetry(() => axios.post(API_ENDPOINTS.fixIssuesBulk, payload));
        return resp?.data;
    };

    const applyNotAnIssueToGroup = async (group) => {
        const payload = { sessionId: data.sessionId, groupSignature: group.signature, idempotencyKey: idempotencyKey() };
        const resp = await requestWithRetry(() => axios.post(API_ENDPOINTS.notAnIssueBulk, payload));
        return resp?.data;
    };

    const promptApplyToSiblingGroups = (baseGroup, action) => {
        const queue = groups.filter(g => g.column === baseGroup.column && g.errorType === baseGroup.errorType && g.signature !== baseGroup.signature);
        if (queue.length === 0) return;
        setFollowUpQueue(queue);
        setFollowUpAction(action);
        setShowFollowUpModal(true);
    };

    const handleFollowUpApply = async () => {
        if (followUpQueue.length === 0) { setShowFollowUpModal(false); return; }
        setIsFollowUpApplying(true);
        try {
            for (const nextGroup of followUpQueue) {
                if (followUpAction === 'fix') await applyFixToGroup(nextGroup);
                else await applyNotAnIssueToGroup(nextGroup);
                removeGroupFromUI(nextGroup.signature);
            }
        } catch (e) {
            console.warn('Follow-up modal apply failed:', e);
        } finally {
            setIsFollowUpApplying(false);
            setShowFollowUpModal(false);
            setFollowUpQueue([]);
        }
    };

    const getGroupSuggestedFix = (group) => {
        return typeof groupOverriddenFixes[group.signature] === 'string' && groupOverriddenFixes[group.signature].length >= 0
            ? groupOverriddenFixes[group.signature]
            : (group.sampleIssue?.suggestedFix || '');
    };

    const handleGroupFixEditStart = (signature) => {
        setGroupEditingSignature(signature);
    };

    const handleGroupFixEdit = (signature, value) => {
        setGroupOverriddenFixes(prev => ({ ...prev, [signature]: value }));
    };

    const handleGroupFixEditEnd = () => {
        setGroupEditingSignature(null);
    };

    // Handle bulk apply modal confirmation
    const handleBulkOverrideConfirm = async () => {
        const { currentIssue, similarIssues, overriddenFix, isOverrideMode } = bulkOverrideData;

        try {
            setIsBulkApplying(true);
            setBulkApplyCompleted(0);
            setBulkApplyTotal((similarIssues?.length || 0) + 1);

            // Build bulk payload for similar issues
            const issueIds = similarIssues.map(issue => issue.id);
            const payload = {
                sessionId: data.sessionId,
                issueIds
            };
            if (isOverrideMode && overriddenFix) {
                payload.overriddenFix = overriddenFix;
            }

            const resp = await axios.post(isOverrideMode ? API_ENDPOINTS.overrideIssuesBulk : API_ENDPOINTS.fixIssuesBulk, payload);

            const fixedIssuesArray = Array.isArray(resp?.data?.fixedIssues) ? resp.data.fixedIssues : [];
            const fixedIdsSet = new Set(fixedIssuesArray.map(fi => fi.id));

            if (fixedIssuesArray.length > 0) {
                // Update issues state for visible rows
                setIssues(prevIssues =>
                    prevIssues.map(issue =>
                        fixedIdsSet.has(issue.id)
                            ? { ...issue, fixed: true, fixedAt: new Date().toISOString(), suggestedFix: (isOverrideMode && overriddenFix) ? overriddenFix : issue.suggestedFix }
                            : issue
                    )
                );
                // For overrides, mutate existing change entries rather than appending duplicates
                if (isOverrideMode && overriddenFix) {
                    setChanges(prevChanges =>
                        prevChanges.map(c =>
                            fixedIdsSet.has(c.id)
                                ? { ...c, suggestedFix: overriddenFix, fixedAt: new Date().toISOString() }
                                : c
                        )
                    );
                } else {
                    setChanges(prevChanges => [...prevChanges, ...fixedIssuesArray]);
                }
            }

            // Progress bar completion for the bulk portion
            setBulkApplyCompleted(similarIssues.length);

            // Close modal UI state
            setShowBulkOverrideModal(false);
            setBulkOverrideData({
                currentIssue: null,
                similarIssues: [],
                originalFix: '',
                overriddenFix: '',
                isOverrideMode: false
            });

            // Fix the original issue as a single call (keeps existing behavior)
            if (isOverrideMode) {
                await axios.post(API_ENDPOINTS.overrideIssue, {
                    sessionId: data.sessionId,
                    issueId: currentIssue.id,
                    overriddenFix
                });
                // Reflect the current card's change locally as well
                setChanges(prev => prev.map(c => c.id === currentIssue.id ? { ...c, suggestedFix: overriddenFix, fixedAt: new Date().toISOString() } : c));
                setIssues(prev => prev.map(i => i.id === currentIssue.id ? { ...i, suggestedFix: overriddenFix, fixedAt: new Date().toISOString() } : i));
            } else {
                await handleFixIssueInternal(currentIssue.id, undefined);
            }
            setBulkApplyCompleted(prev => Math.min(prev + 1, bulkApplyTotal));

            const totalRequested = issueIds.length;
            const applied = fixedIssuesArray.length;
            const alreadyFixed = Array.isArray(resp?.data?.alreadyFixedIds) ? resp.data.alreadyFixedIds.length : 0;
            const notFound = Array.isArray(resp?.data?.notFoundIds) ? resp.data.notFoundIds.length : 0;
            const failed = Math.max(0, totalRequested - applied - alreadyFixed - notFound);
            if (failed > 0 || notFound > 0) {
                alert(`Applied ${applied} fixes. ${failed + notFound} did not apply. You can retry.`);
            }

        } catch (error) {
            console.error('Error applying bulk fix:', error);
            alert('Failed to apply bulk fix. Please try again.');
        } finally {
            setIsBulkApplying(false);
        }
    };
    // Not An Issue confirm
    const handleNotIssueConfirm = async () => {
        try {
            setIsNotIssueApplying(true);
            const { currentIssue, similarIssues, char } = notIssueData;
            if (char) {
                try {
                    await axios.post(API_ENDPOINTS.notAnIssue, { char, description: 'User approved from UI' });
                } catch (err) {
                    // If backend is not yet redeployed with this endpoint, ignore 404 and continue client-side
                    if (!(err?.response && err.response.status === 404)) {
                        throw err;
                    }
                    console.warn('not-an-issue endpoint unavailable on backend; proceeding without persisting whitelist');
                }
            }

            const issueIds = similarIssues.map(sim => sim.id);
            const resp = await axios.post(API_ENDPOINTS.notAnIssueBulk, {
                sessionId: data.sessionId,
                issueIds
            });

            const fixedIssuesArray = Array.isArray(resp?.data?.fixedIssues) ? resp.data.fixedIssues : [];
            const fixedIds = new Set(fixedIssuesArray.map(fi => fi.id));

            setIssues(prev => prev.map(i => fixedIds.has(i.id) ? { ...i, fixed: true, suggestedFix: currentIssue.originalValue, fixedAt: new Date().toISOString() } : i));
            // Update existing change entries rather than duplicating
            setChanges(prev => prev.map(c => fixedIds.has(c.id) ? { ...c, suggestedFix: currentIssue.originalValue, fixedAt: new Date().toISOString() } : c));
        } catch (e) {
            console.error('Not An Issue confirm failed:', e);
            alert('Failed to apply Not An Issue.');
        } finally {
            setShowNotIssueModal(false);
            setNotIssueData({ currentIssue: null, similarIssues: [], char: null });
            setIsNotIssueApplying(false);
        }
    };

    // Not An Issue for just this one cell
    const handleNotIssueSingle = async () => {
        try {
            setIsNotIssueApplying(true);
            const { currentIssue, char } = notIssueData;
            if (!currentIssue) return;
            if (char) {
                try {
                    await axios.post(API_ENDPOINTS.notAnIssue, { char, description: 'User approved from UI' });
                } catch (err) {
                    if (!(err?.response && err.response.status === 404)) {
                        throw err;
                    }
                    console.warn('not-an-issue endpoint unavailable on backend; proceeding without persisting whitelist');
                }
            }
            const resp = await axios.post(API_ENDPOINTS.fixIssue, {
                sessionId: data.sessionId,
                issueId: currentIssue.id,
                overriddenFix: currentIssue.originalValue
            });
            if (resp.data?.success) {
                setIssues(prev => prev.map(i => i.id === currentIssue.id ? { ...i, fixed: true, suggestedFix: currentIssue.originalValue, fixedAt: new Date().toISOString() } : i));
                setChanges(prev => [...prev, resp.data.fixedIssue]);
            }
        } catch (e) {
            console.error('Not An Issue single failed:', e);
            alert('Failed to apply Not An Issue to this cell.');
        } finally {
            setShowNotIssueModal(false);
            setNotIssueData({ currentIssue: null, similarIssues: [], char: null });
            setIsNotIssueApplying(false);
        }
    };

    const handleNotIssueCancel = () => {
        setShowNotIssueModal(false);
        setNotIssueData({ currentIssue: null, similarIssues: [], char: null });
    };

    // Close bulk apply modal and fix only current issue
    const handleBulkOverrideCancel = async () => {
        const { currentIssue, overriddenFix, isOverrideMode } = bulkOverrideData;

        setShowBulkOverrideModal(false);
        setBulkOverrideData({
            currentIssue: null,
            similarIssues: [],
            originalFix: '',
            overriddenFix: '',
            isOverrideMode: false
        });

        // Fix only the current issue
        await handleFixIssueInternal(currentIssue.id, isOverrideMode ? overriddenFix : undefined);
    };

    // Internal fix issue function (without bulk override check)
    const handleFixIssueInternal = async (issueId, overriddenFix) => {
        try {
            const response = await axios.post(API_ENDPOINTS.fixIssue, {
                sessionId: data.sessionId,
                issueId: issueId,
                overriddenFix: overriddenFix
            });

            if (response.data.success) {
                // Check if this was a new issue that got overridden
                if (newIssueIds.has(issueId) && overriddenFix) {
                    // Remove from new issues and add to overridden new issues
                    setNewIssueIds(prevNewIds => {
                        const newSet = new Set(prevNewIds);
                        newSet.delete(issueId);
                        return newSet;
                    });
                    setNewIssuesOverridden(prevOverridden => {
                        const newSet = new Set(prevOverridden);
                        newSet.add(issueId);
                        return newSet;
                    });
                }

                // Update the issue as fixed
                setIssues(prevIssues =>
                    prevIssues.map(issue =>
                        issue.id === issueId ? { ...issue, fixed: true, fixedAt: response.data.fixedIssue.fixedAt } : issue
                    )
                );

                // Add the change to changes list
                setChanges(prevChanges => [...prevChanges, response.data.fixedIssue]);
            }
        } catch (error) {
            console.error('Error fixing issue:', error);
            alert('Failed to fix issue. Please try again.');
        }
    };

    // Main handleFixIssue function with bulk apply check
    const handleFixIssue = async (issueId) => {
        const currentIssue = issues.find(issue => issue.id === issueId);
        const overriddenFix = overriddenFixes[issueId];

        // Check for similar cells (either with override or with suggested fix)
        const similarIssues = findSimilarCells(currentIssue);

        if (similarIssues.length > 0) {
            // Determine if this is an override mode or suggested fix mode
            const isOverrideMode = overriddenFix && overriddenFix !== currentIssue.suggestedFix;

            // Show bulk apply modal
            setBulkOverrideData({
                currentIssue,
                similarIssues,
                originalFix: currentIssue.suggestedFix,
                overriddenFix: overriddenFix || currentIssue.suggestedFix,
                isOverrideMode
            });
            setShowBulkOverrideModal(true);
            return; // Wait for user decision
        }

        // No similar cells, proceed normally
        await handleFixIssueInternal(issueId, overriddenFix);
    };

    // Filter and sort data based on search term, with new issues first
    const filteredData = useMemo(() => {
        if (showChanges) {
            // Group fixed changes (by column + type + originalValue)
            const lower = (s) => String(s || '').toLowerCase();
            const groups = new Map();
            for (const ch of changes) {
                const errorType = ch.hasInvalidChars ? 'invalid_characters' : (ch.hasLengthIssues ? 'length_violation' : 'unknown');
                const key = `${ch.column}|${errorType}|${ch.originalValue}`;
                if (!groups.has(key)) {
                    groups.set(key, {
                        key,
                        column: ch.column,
                        errorType,
                        value: ch.originalValue,
                        count: 0,
                        sampleChange: ch,
                        cellRefs: [],
                        issueIds: []
                    });
                }
                const g = groups.get(key);
                g.count += 1;
                g.cellRefs.push(ch.cellReference || `${ch.column}${ch.row}`);
                g.issueIds.push(ch.id);
            }
            let arr = Array.from(groups.values());
            if (searchTerm) {
                const q = lower(searchTerm);
                arr = arr.filter(g => lower(g.column).includes(q) || lower(g.value).includes(q) || lower(g.sampleChange?.problem || '').includes(q));
            }
            // Sort by column, then count desc, then value
            arr.sort((a, b) => {
                if (a.column === b.column) {
                    if (b.count === a.count) return String(a.value).localeCompare(String(b.value));
                    return b.count - a.count;
                }
                return String(a.column).localeCompare(String(b.column));
            });
            return arr;
        } else {
            // Grouped view: operate on groups, default on
            let allGroups = groups;
            if (searchTerm) {
                const q = searchTerm.toLowerCase();
                allGroups = allGroups.filter(g =>
                    String(g.column || '').toLowerCase().includes(q) ||
                    String(g.value || '').toLowerCase().includes(q) ||
                    String(g.sampleIssue?.problem || '').toLowerCase().includes(q)
                );
            }
            // Sort: column asc, count desc, value asc
            return [...allGroups].sort((a, b) => {
                if (a.column === b.column) {
                    if (b.count === a.count) return String(a.value).localeCompare(String(b.value));
                    return b.count - a.count;
                }
                return String(a.column).localeCompare(String(b.column));
            });
        }
    }, [groups, changes, searchTerm, showChanges, newIssueIds, newIssuesOverridden]);

    const handleSuggestedFixEdit = (issueId, newFix) => {
        setOverriddenFixes(prev => ({
            ...prev,
            [issueId]: newFix
        }));
    };

    const handleFixEditStart = (issueId) => {
        setEditingFixId(issueId);
    };

    const handleFixEditEnd = () => {
        setEditingFixId(null);
    };



    const getSuggestedFix = (issue) => {
        return overriddenFixes[issue.id] || issue.suggestedFix;
    };

    const isFixOverridden = (issueId) => {
        return overriddenFixes[issueId] && overriddenFixes[issueId] !== issues.find(i => i.id === issueId)?.suggestedFix;
    };

    // Normalize problem text to use server-provided max length where older messages were hardcoded
    const formatProblem = (problem) => {
        if (!problem) return '';
        const maxLen = data.maxCellLength || Number.MAX_SAFE_INTEGER;
        return problem
            .replace(/Length exceeds\s+\d+\s+characters/g, `Length exceeds ${maxLen} characters`)
            .replace(/max\s+\d+\b/g, `max ${maxLen}`);
    };

    // Change override functions
    const handleChangeEditStart = (issueId) => {
        setEditingChangeId(issueId);
    };

    const handleChangeEditEnd = () => {
        setEditingChangeId(null);
    };

    const handleChangeEdit = (issueId, newFix) => {
        setOverriddenChanges(prev => ({
            ...prev,
            [issueId]: newFix
        }));
    };

    const getFixedValue = (change) => {
        return overriddenChanges[change.id] || change.suggestedFix;
    };

    const isChangeOverridden = (changeId) => {
        return overriddenChanges[changeId] && overriddenChanges[changeId] !== changes.find(c => c.id === changeId)?.suggestedFix;
    };

    const handleOverrideChange = async (change) => {
        try {
            const overriddenFix = getFixedValue(change);

            // Debug logging to understand the structure
            console.log('Change object:', change);
            console.log('Session ID:', data.sessionId);
            console.log('Change ID:', change.id);
            console.log('Change changeId:', change.changeId);
            console.log('Overridden fix:', overriddenFix);

            // Store the override pattern for learning
            // Use the original issue ID, not the changeId
            const response = await axios.post(API_ENDPOINTS.overrideIssue, {
                sessionId: data.sessionId,
                issueId: change.id, // This should be the original issue.id from the spread
                overriddenFix: overriddenFix
            });

            if (response.data.success) {
                // Update the change in the changes list
                setChanges(prevChanges =>
                    prevChanges.map(c =>
                        c.id === change.id ? { ...c, suggestedFix: overriddenFix, fixedAt: new Date().toISOString() } : c
                    )
                );

                // Update the corresponding issue in issues list  
                setIssues(prevIssues =>
                    prevIssues.map(issue =>
                        issue.id === change.id ? { ...issue, suggestedFix: overriddenFix, fixedAt: new Date().toISOString() } : issue
                    )
                );

                // Clear the override and editing state
                setOverriddenChanges(prev => {
                    const newState = { ...prev };
                    delete newState[change.id];
                    return newState;
                });
                setEditingChangeId(null);

                // Check for similar fixes if this is an override
                if (isChangeOverridden(change.id)) {
                    checkForSimilarFixes(change, overriddenFix, true);
                }
            }
        } catch (error) {
            console.error('Error overriding change:', error);
            alert('Failed to override change. Please try again.');
        }
    };

    const checkForSimilarFixes = async (currentChange, newFix, isOverride = false) => {
        const originalFix = currentChange.suggestedFix;

        // Find other changes with the same original value and current suggested fix
        const similarChanges = changes.filter(change =>
            change.id !== currentChange.id &&
            change.originalValue === currentChange.originalValue &&
            change.suggestedFix === originalFix
        );

        if (similarChanges.length > 0) {
            setBulkOverrideData({
                currentIssue: currentChange,
                similarIssues: similarChanges,
                originalFix: originalFix,
                overriddenFix: newFix,
                isOverrideMode: isOverride
            });
            setShowBulkOverrideModal(true);
        }
    };

    const handleFixAll = async () => {
        setIsFixingAll(true);
        setIsFixAllApplying(true);
        setFixAllCompleted(0);
        // Estimate total from remaining issues if available
        const totalEst = Math.max(0, (typeof data.issueCount === 'number' ? data.issueCount : (Array.isArray(issues) ? issues.length : 0)) - changes.length);
        setFixAllTotal(totalEst);
        try {
            // Sequentially process pages of 20,000 unfixed issues until none remain
            const PAGE_LIMIT = 20000;
            // Safety cap to avoid infinite loops
            let safetyIterations = 1000;
            // eslint-disable-next-line no-constant-condition
            while (true && safetyIterations-- > 0) {
                // Always request from offset 0, only unfixed, so pagination adjusts as server state changes
                const pageRes = await requestWithRetry(() => axios.get(API_ENDPOINTS.getIssuesPage(data.sessionId, 0, PAGE_LIMIT, true)));
                const pageIssues = Array.isArray(pageRes?.data?.issues) ? pageRes.data.issues : [];
                if (pageIssues.length === 0) break;

                const issueIds = pageIssues.filter(i => !i.fixed).map(i => i.id);
                if (issueIds.length === 0) break;

                const bulkRes = await requestWithRetry(() => axios.post(API_ENDPOINTS.fixIssuesBulk, {
                    sessionId: data.sessionId,
                    issueIds
                }));

                const fixedIssuesArray = Array.isArray(bulkRes?.data?.fixedIssues) ? bulkRes.data.fixedIssues : [];
                const fixedIdsSet = new Set(fixedIssuesArray.map(fi => fi.id));

                // Update local state for issues currently loaded in the UI
                if (fixedIdsSet.size > 0) {
                    setIssues(prevIssues =>
                        prevIssues.map(issue =>
                            fixedIdsSet.has(issue.id)
                                ? { ...issue, fixed: true, fixedAt: new Date().toISOString() }
                                : issue
                        )
                    );
                    setChanges(prev => [...prev, ...fixedIssuesArray]);
                }

                setFixAllCompleted(prev => prev + fixedIssuesArray.length);

                // Yield to UI between pages
                await new Promise(r => setTimeout(r, 50));
            }

            setShowChanges(true);
        } catch (error) {
            console.error('Error fixing all issues:', error);
            alert('Failed to fix all issues. Please try again.');
        } finally {
            setIsFixingAll(false);
            setIsFixAllApplying(false);
        }
    };

    const downloadIssuesCSV = () => {
        // Download only unfixed issues
        const unfixedIssues = issues.filter(issue => !issue.fixed);
        const headers = ['Cell Reference', 'Row', 'Column', 'Problem', 'Original Value', 'Suggested Fix'];

        const csvContent = [
            headers.join(','),
            ...unfixedIssues.map(item => [
                `"${item.cellReference || `${item.column}${item.row}`}"`,
                item.row,
                `"${item.column}"`,
                `"${item.problem}"`,
                `"${item.originalValue.replace(/"/g, '""')}"`,
                `"${item.suggestedFix.replace(/"/g, '""')}"`
            ].join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');

        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            const filename = `${data.filename}_issues_report.csv`;
            link.setAttribute('href', url);
            link.setAttribute('download', filename);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    };

    const downloadChangesCSV = () => {
        // Download only fixed issues
        const fixedIssues = issues.filter(issue => issue.fixed);
        const headers = ['Cell Reference', 'Row', 'Column', 'Problem', 'Original Value', 'Fixed Value', 'Fixed At'];

        const csvContent = [
            headers.join(','),
            ...fixedIssues.map(item => [
                `"${item.cellReference || `${item.column}${item.row}`}"`,
                item.row,
                `"${item.column}"`,
                `"${item.problem}"`,
                `"${item.originalValue.replace(/"/g, '""')}"`,
                `"${item.suggestedFix.replace(/"/g, '""')}"`,
                `"${item.fixedAt || new Date().toISOString()}"`
            ].join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');

        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            const filename = `${data.filename}_changes_report.csv`;
            link.setAttribute('href', url);
            link.setAttribute('download', filename);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    };

    const downloadFixedCSV = async () => {
        try {
            // Download the original file with all fixes applied
            const response = await fetch(API_ENDPOINTS.downloadFixed(data.sessionId));

            if (!response.ok) {
                if (response.status === 404) {
                    const errorData = await response.json();
                    if (errorData.error === 'Original file no longer available') {
                        alert('The original file is no longer available. Please re-upload your file to generate a fixed version.');
                    } else {
                        alert('Session not found. Please re-upload your file.');
                    }
                } else {
                    throw new Error(`Server error: ${response.status}`);
                }
                return;
            }

            const blob = await response.blob();
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);

            // Extract filename from response headers or use default
            const contentDisposition = response.headers.get('content-disposition');
            let filename = `${data.filename}_FIXED.csv`;
            if (contentDisposition) {
                const filenameMatch = contentDisposition.match(/filename="([^"]+)"/);
                if (filenameMatch) {
                    filename = filenameMatch[1];
                }
            }

            link.setAttribute('href', url);
            link.setAttribute('download', filename);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Error downloading fixed CSV:', error);
            alert('Error downloading fixed CSV. Please try again.');
        }
    };

    // Paginate filtered data
    const paginatedData = useMemo(() => {
        const startIndex = (currentPage - 1) * pageSize;
        return filteredData.slice(startIndex, startIndex + pageSize);
    }, [filteredData, currentPage, pageSize]);

    const totalPages = Math.ceil(filteredData.length / pageSize);

    // Totals: prefer server-provided count (full) over preview length
    const totalIssueCount = useMemo(() => {
        if (typeof data.issueCount === 'number') return data.issueCount;
        return Array.isArray(issues) ? issues.length : 0;
    }, [data.issueCount, issues]);

    // Remaining = total issues - fixed issues (changes)
    const remainingIssues = Math.max(0, totalIssueCount - changes.length);
    const formatNumber = (n) => {
        const num = typeof n === 'number' && isFinite(n) ? n : 0;
        try { return num.toLocaleString(); } catch { return String(num); }
    };

    const goToPage = (page) => {
        setCurrentPage(Math.max(1, Math.min(page, totalPages)));
    };

    return (
        <div className="report-display">
            <div className="report-header">
                <h2>🔍 Data Quality Analysis</h2>
                <p><strong>File:</strong> {data.filename}</p>

                <div className="report-stats">
                    <div className="stat-card">
                        <span className="stat-number">{formatNumber(data.totalRows)}</span>
                        <span className="stat-label">Total Rows</span>
                    </div>
                    <div className="stat-card">
                        <span className="stat-number">{data.totalColumns}</span>
                        <span className="stat-label">Total Columns</span>
                    </div>
                    <div className="stat-card">
                        <span className="stat-number">{formatNumber(totalIssueCount)}</span>
                        <span className="stat-label">Quality Issues</span>
                    </div>
                    <div className="stat-card">
                        <span className="stat-number">{formatNumber(remainingIssues)}</span>
                        <span className="stat-label">Remaining Issues</span>
                    </div>
                    <div className="stat-card">
                        <span className="stat-number">{formatNumber(changes.length)}</span>
                        <span className="stat-label">Fixed Issues</span>
                    </div>
                </div>
            </div>

            <div className="report-content">
                {totalIssueCount === 0 ? (
                    <div style={{ textAlign: 'center', padding: '3rem' }}>
                        <h3 style={{ color: '#48bb78', marginBottom: '1rem' }}>✅ No Data Quality Issues Found!</h3>
                        <p style={{ color: '#666', marginBottom: '2rem' }}>
                            Your data file passed all quality checks. All cells contain valid characters and are within the 100-character limit.
                        </p>
                        <button onClick={onReset} className="btn btn-primary">
                            Analyze Another File
                        </button>
                    </div>
                ) : (
                    <>
                        {/* Action Buttons */}
                        <div className="report-actions">
                            <input
                                type="text"
                                placeholder={showChanges ? "Search changes (cell reference, value, etc.)..." : "Search issues (cell reference, value, problem, etc.)..."}
                                className="search-box"
                                value={searchTerm}
                                onChange={(e) => {
                                    setSearchTerm(e.target.value);
                                    setCurrentPage(1);
                                }}
                            />

                            {!showChanges && remainingIssues > 0 && (
                                <button
                                    onClick={handleFixAll}
                                    className="btn btn-primary"
                                    disabled={isFixingAll}
                                >
                                    {isFixingAll ? '🔄 Fixing All...' : '🛠️ Fix All Issues'}
                                </button>
                            )}

                            <button
                                onClick={() => {
                                    setShowChanges(!showChanges);
                                    setSearchTerm('');
                                    setCurrentPage(1);
                                }}
                                className="btn btn-secondary"
                            >
                                {showChanges ? '📝 Show Issues' : '📋 Show Changes'} ({showChanges ? remainingIssues : changes.length})
                            </button>

                            <button onClick={downloadIssuesCSV} className="btn btn-success">
                                📥 Download Issues CSV
                            </button>

                            <button onClick={downloadChangesCSV} className="btn btn-success">
                                📋 Download Changes CSV
                            </button>

                            <button onClick={downloadFixedCSV} className="btn btn-success">
                                📋 Download Fixed CSV
                            </button>

                            <button onClick={onReset} className="btn btn-secondary">
                                🔄 Analyze New File
                            </button>
                        </div>

                        {/* Truncated preview notice */}
                        {data.truncated && (
                            <div style={{ margin: '0.75rem 0 1rem 0', padding: '0.75rem 1rem', background: '#fffbea', border: '1px solid #f6e05e', color: '#744210', borderRadius: '6px' }}>
                                Showing the first {formatNumber(issues.length)} of {formatNumber(totalIssueCount)} issues. The full list is stored on the server for fixing and downloads.
                            </div>
                        )}

                        {filteredData.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '2rem' }}>
                                <p style={{ color: '#666' }}>
                                    {showChanges ? 'No changes made yet.' : 'No issues match your search criteria.'}
                                </p>
                            </div>
                        ) : (
                            <>
                                <div style={{ marginBottom: '1rem', color: '#666' }}>
                                    Showing {((currentPage - 1) * pageSize) + 1}-{Math.min(currentPage * pageSize, filteredData.length)} of {filteredData.length.toLocaleString()} {showChanges ? 'changes' : 'issues'}
                                    {searchTerm && ` (filtered)`}
                                </div>

                                {/* Issues/Changes Display - grouped by default when not showing changes */}
                                <div className="issues-container">
                                    {paginatedData.map((item, index) => (
                                        showChanges ? (
                                            // Grouped Changes Display
                                            <div key={`change-group-${item.key}-${index}`} className="issue-card change-card">
                                                <div className="issue-header">
                                                    <button
                                                        className="issue-location"
                                                        aria-expanded={expandedChangeGroups.has(item.key) ? 'true' : 'false'}
                                                        onClick={() => setExpandedChangeGroups(prev => { const next = new Set(prev); next.has(item.key) ? next.delete(item.key) : next.add(item.key); return next; })}
                                                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'transparent', border: 0, padding: 0, cursor: 'pointer' }}
                                                    >
                                                        <span style={{ display: 'inline-block', transform: expandedChangeGroups.has(item.key) ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s ease' }}>❯</span>
                                                        <span>
                                                            Cell {item.sampleChange?.cellReference || `${item.sampleChange?.column}${item.sampleChange?.row}`} • Column: {item.column}
                                                        </span>
                                                    </button>
                                                    <span className="change-timestamp">
                                                        {item.sampleChange?.fixedAt ? new Date(item.sampleChange.fixedAt).toLocaleTimeString() : 'Fixed'}
                                                        <span style={{ marginLeft: '0.5rem', color: '#4a5568' }}>× {item.count.toLocaleString()}</span>
                                                    </span>
                                                </div>

                                                {expandedChangeGroups.has(item.key) && (
                                                    <div className="issue-content" role="region" aria-label={`Affected cells for ${item.column} ${item.errorType}`} style={{ borderBottom: '1px solid #e2e8f0', paddingBottom: '1rem', marginBottom: '1rem' }}>
                                                        <div className="value-section">
                                                            <label>Affected Cells:</label>
                                                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                                                <textarea
                                                                    readOnly
                                                                    spellCheck={false}
                                                                    className="cell-refs"
                                                                    rows={1}
                                                                    value={(item.cellRefs || []).join(',')}
                                                                    style={{ height: '2.4rem', padding: '0.35rem 0.5rem', lineHeight: '1.2rem', width: '100%', whiteSpace: 'nowrap', overflowX: 'auto', overflowY: 'hidden', resize: 'none', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace' }}
                                                                />
                                                                <button className="btn btn-secondary btn-sm" onClick={() => navigator.clipboard.writeText((item.cellRefs || []).join(','))}>Copy</button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Sample original/fixed values */}
                                                <div className="change-content">
                                                    <div className="change-before">
                                                        <label>Original:</label>
                                                        <div className="value-display original-value">{item.sampleChange?.originalValue}</div>
                                                    </div>
                                                    <div className="change-arrow">→</div>
                                                    <div className="change-after">
                                                        <label>Fixed:</label>
                                                        <div
                                                            className={`value-display fixed-value ${groupChangeEditingKey === item.key ? '' : 'hoverable'}`}
                                                            onClick={() => setGroupChangeEditingKey(item.key)}
                                                        >
                                                            {groupChangeEditingKey === item.key ? (
                                                                <input
                                                                    type="text"
                                                                    value={typeof groupChangeOverriddenFixes[item.key] === 'string' ? groupChangeOverriddenFixes[item.key] : (item.sampleChange?.suggestedFix || '')}
                                                                    onChange={(e) => setGroupChangeOverriddenFixes(prev => ({ ...prev, [item.key]: e.target.value }))}
                                                                    onBlur={() => setGroupChangeEditingKey(null)}
                                                                    onKeyPress={(e) => { if (e.key === 'Enter') setGroupChangeEditingKey(null); }}
                                                                    autoFocus
                                                                    className="edit-fix-input"
                                                                />
                                                            ) : (
                                                                (typeof groupChangeOverriddenFixes[item.key] === 'string' ? groupChangeOverriddenFixes[item.key] : (item.sampleChange?.suggestedFix || ''))
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                                {item.sampleChange?.problem && (
                                                    <div style={{ marginTop: '1rem', fontSize: '0.875rem', color: '#718096' }}>
                                                        <strong>Issue:</strong> {item.sampleChange.problem}
                                                    </div>
                                                )}

                                                {(groupChangeEditingKey === item.key || (typeof groupChangeOverriddenFixes[item.key] === 'string' && groupChangeOverriddenFixes[item.key] !== (item.sampleChange?.suggestedFix || ''))) && (
                                                    <div className="actions-and-warning-container">
                                                        <div className="override-actions">
                                                            <button
                                                                className="btn btn-warning override-button"
                                                                onClick={async () => {
                                                                    try {
                                                                        const overriddenFix = typeof groupChangeOverriddenFixes[item.key] === 'string' ? groupChangeOverriddenFixes[item.key] : (item.sampleChange?.suggestedFix || '');
                                                                        if (!overriddenFix) return;
                                                                        await axios.post(API_ENDPOINTS.overrideIssuesBulk, {
                                                                            sessionId: data.sessionId,
                                                                            issueIds: item.issueIds,
                                                                            overriddenFix
                                                                        });
                                                                        // Update local state
                                                                        setChanges(prev => prev.map(ch => item.issueIds.includes(ch.id) ? { ...ch, suggestedFix: overriddenFix, fixedAt: new Date().toISOString() } : ch));
                                                                        setGroupChangeEditingKey(null);
                                                                    } catch (e) {
                                                                        console.error('Group override failed:', e);
                                                                        alert('Failed to apply override to this group.');
                                                                    }
                                                                }}
                                                            >
                                                                ⚠️ Override
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            // Grouped issues card
                                            <div key={`group-${item.signature}-${index}`} className="issue-card">
                                                <div className="issue-header">
                                                    <button
                                                        className="issue-location"
                                                        aria-expanded={isGroupExpanded(item.signature) ? 'true' : 'false'}
                                                        onClick={() => toggleGroupExpand(item.signature)}
                                                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'transparent', border: 0, padding: 0, cursor: 'pointer' }}
                                                    >
                                                        <span style={{ display: 'inline-block', transform: isGroupExpanded(item.signature) ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s ease' }}>❯</span>
                                                        <span>
                                                            Cell {item.sampleIssue?.cellReference || `${item.sampleIssue?.column}${item.sampleIssue?.row}`} • Column: {item.column}
                                                        </span>
                                                    </button>
                                                    <span className={`problem-badge`}>
                                                        {formatProblem(item.sampleIssue?.problem || (item.errorType === 'invalid_characters' ? 'Invalid characters' : 'Length exceeds'))}
                                                        <span style={{ marginLeft: '0.5rem', color: '#4a5568' }}>× {item.count.toLocaleString()}</span>
                                                    </span>
                                                </div>

                                                {isGroupExpanded(item.signature) && (
                                                    <div className="issue-content" role="region" aria-label={`Affected cells for ${item.column} ${item.errorType}`} style={{ borderBottom: '1px solid #e2e8f0', paddingBottom: '1rem', marginBottom: '1rem' }}>
                                                        <div className="value-section">
                                                            <label>Affected Cells:</label>
                                                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                                                <textarea
                                                                    readOnly
                                                                    spellCheck={false}
                                                                    className="cell-refs"
                                                                    rows={1}
                                                                    value={(groupRefsCache.get(item.signature)?.cellRefs || []).join(',')}
                                                                    style={{ height: '2.4rem', padding: '0.35rem 0.5rem', lineHeight: '1.2rem', width: '100%', whiteSpace: 'nowrap', overflowX: 'auto', overflowY: 'hidden', resize: 'none', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace' }}
                                                                />
                                                                <button className="btn btn-secondary btn-sm" onClick={() => copyRefsToClipboard(item.signature)}>Copy</button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Original card content ALWAYS visible below the line */}
                                                <div className="issue-content">
                                                    <div className="value-section">
                                                        <label>Current Value:</label>
                                                        <div className="value-display current-value">{item.sampleIssue?.originalValue}</div>
                                                    </div>
                                                    <div className="suggested-fix-section">
                                                        <label>Suggested Fix:</label>
                                                        <div
                                                            className={`value-display suggested-value ${groupEditingSignature === item.signature ? '' : 'hoverable'}`}
                                                            onClick={() => {
                                                                if (groupEditingSignature !== item.signature) {
                                                                    handleGroupFixEditStart(item.signature);
                                                                }
                                                            }}
                                                        >
                                                            {groupEditingSignature === item.signature ? (
                                                                <input
                                                                    type="text"
                                                                    value={getGroupSuggestedFix(item)}
                                                                    onChange={(e) => handleGroupFixEdit(item.signature, e.target.value)}
                                                                    onBlur={handleGroupFixEditEnd}
                                                                    onKeyPress={(e) => { if (e.key === 'Enter') handleGroupFixEditEnd(); }}
                                                                    autoFocus
                                                                    className="edit-fix-input"
                                                                />
                                                            ) : (
                                                                getGroupSuggestedFix(item)
                                                            )}
                                                        </div>
                                                    </div>
                                                    {item.sampleIssue?.hasInvalidChars && item.sampleIssue?.invalidCharacters && item.sampleIssue.invalidCharacters.length > 0 && (
                                                        <div className="character-details">
                                                            <label>Invalid Characters Found:</label>
                                                            <div className="character-list">
                                                                {item.sampleIssue.invalidCharacters.slice(0, 5).map((char, charIndex) => (
                                                                    <span key={charIndex} className="character-badge">
                                                                        "{char.char}" (U+{char.charCode.toString(16).toUpperCase().padStart(4, '0')}) - {char.description}
                                                                        {char.replacement && ` → "${char.replacement}"`}
                                                                    </span>
                                                                ))}
                                                                {item.sampleIssue.invalidCharacters.length > 5 && (
                                                                    <span className="character-badge" style={{ background: '#e2e8f0', color: '#4a5568' }}>
                                                                        +{item.sampleIssue.invalidCharacters.length - 5} more characters
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="actions-and-warning-container">
                                                    <div className="issue-actions">
                                                        <button
                                                            onClick={async () => {
                                                                try {
                                                                    await applyFixToGroup(item);
                                                                    removeGroupFromUI(item.signature);
                                                                    await promptApplyToSiblingGroups(item, 'fix');
                                                                } catch (e) {
                                                                    console.error('Bulk fix by signature failed:', e);
                                                                    alert('Failed to apply fix to group.');
                                                                }
                                                            }}
                                                            className="btn btn-primary btn-sm"
                                                        >
                                                            🛠️ Fix This Issue
                                                        </button>
                                                        <button
                                                            onClick={async () => {
                                                                try {
                                                                    await applyNotAnIssueToGroup(item);
                                                                    removeGroupFromUI(item.signature);
                                                                    await promptApplyToSiblingGroups(item, 'notAnIssue');
                                                                } catch (e) {
                                                                    console.error('Not An Issue by signature failed:', e);
                                                                    alert('Failed to mark group as Not An Issue.');
                                                                }
                                                            }}
                                                            className="btn btn-secondary btn-sm"
                                                            style={{ marginLeft: '0.5rem' }}
                                                        >
                                                            ✅ Not An Issue
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    ))}
                                </div>

                                {/* Pagination */}
                                {totalPages > 1 && (
                                    <div className="pagination">
                                        <button
                                            onClick={() => goToPage(currentPage - 1)}
                                            disabled={currentPage === 1}
                                        >
                                            ← Previous
                                        </button>

                                        <span style={{ margin: '0 1rem', color: '#666' }}>
                                            Page {currentPage} of {totalPages}
                                        </span>

                                        <button
                                            onClick={() => goToPage(currentPage + 1)}
                                            disabled={currentPage === totalPages}
                                        >
                                            Next →
                                        </button>
                                    </div>
                                )}

                                {/* Load more block for truncated sessions */}
                                {data.truncated && issues.length < totalIssueCount && (
                                    <div style={{ textAlign: 'center', marginTop: '1rem' }}>
                                        <button className="btn btn-primary" onClick={loadMoreIssues} disabled={isLoadingMore}>
                                            {isLoadingMore ? 'Loading more…' : `Load next ${Math.min(20000, totalIssueCount - issues.length).toLocaleString()} issues`}
                                        </button>
                                    </div>
                                )}
                            </>
                        )}
                    </>
                )}
            </div>

            {/* Bulk Apply Modal */}
            {showBulkOverrideModal && (
                <div className="modal-overlay">
                    <div className="modal-content bulk-override-modal">
                        {isBulkApplying && (
                            <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.7)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 20 }}>
                                <div style={{ width: 36, height: 36, border: '4px solid #cbd5e0', borderTopColor: '#667eea', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                                <div style={{ marginTop: '0.75rem', color: '#4a5568' }}>
                                    Applying {bulkApplyCompleted}/{bulkApplyTotal}...
                                </div>
                            </div>
                        )}
                        <div className="modal-header" style={{ position: 'relative' }}>
                            <button
                                onClick={handleBulkOverrideCancel}
                                aria-label="Close"
                                className="modal-close"
                                style={{ position: 'absolute', right: '12px', top: '10px', background: 'transparent', border: 'none', fontSize: '20px', cursor: 'pointer', zIndex: 10 }}
                                disabled={isBulkApplying}
                            >×</button>
                            <h3>🔄 Apply to Similar Cells?</h3>
                            <p>We found {bulkOverrideData.similarIssues.length} other cell{bulkOverrideData.similarIssues.length > 1 ? 's' : ''} with the same issue.</p>
                        </div>

                        <div className="modal-body">
                            <div className="override-comparison">
                                <div className="override-section">
                                    <label>Original Value:</label>
                                    <div className="value-display original-value">
                                        {bulkOverrideData.currentIssue?.originalValue}
                                    </div>
                                </div>

                                <div className="override-section">
                                    <label>Suggested Fix:</label>
                                    <div className="value-display suggested-value">
                                        {bulkOverrideData.originalFix}
                                    </div>
                                </div>

                                {bulkOverrideData.isOverrideMode && (
                                    <div className="override-section">
                                        <label>Your Override:</label>
                                        <div className="value-display fixed-value">
                                            {bulkOverrideData.overriddenFix}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="similar-cells-info">
                                <div className="similar-cells-inline">
                                    <span className="similar-cells-label"><strong>Similar cells found:</strong></span>
                                    <div className="similar-cells-list">
                                        {bulkOverrideData.similarIssues.slice(0, 5).map(issue => (
                                            <span key={issue.id} className="cell-reference">
                                                {issue.cellReference || `${issue.column}${issue.row}`}
                                            </span>
                                        ))}
                                        {bulkOverrideData.similarIssues.length > 5 && (
                                            <span className="more-cells">
                                                +{bulkOverrideData.similarIssues.length - 5} more
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="modal-question">
                                <p><strong>
                                    {bulkOverrideData.isOverrideMode
                                        ? 'Do you want to apply this change to all similar cells?'
                                        : 'Do you want to apply this fix to all similar cells?'
                                    }
                                </strong></p>
                            </div>
                        </div>

                        <div className="modal-actions">
                            <button
                                onClick={handleBulkOverrideConfirm}
                                className="btn btn-primary"
                                disabled={isBulkApplying}
                            >
                                {isBulkApplying ? 'Applying…' : '✅ Yes, Apply to All'}
                            </button>
                            <button
                                onClick={handleBulkOverrideCancel}
                                className="btn btn-secondary"
                                disabled={isBulkApplying}
                            >
                                ❌ No, Just This One
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Follow-up Apply Modal */}
            {showFollowUpModal && (
                <div className="modal-overlay">
                    <div className="modal-content bulk-override-modal">
                        {isFollowUpApplying && (
                            <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.7)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 20 }}>
                                <div style={{ width: 36, height: 36, border: '4px solid #cbd5e0', borderTopColor: '#667eea', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                                <div style={{ marginTop: '0.75rem', color: '#4a5568' }}>
                                    Applying to {followUpQueue.length} group{followUpQueue.length > 1 ? 's' : ''}...
                                </div>
                            </div>
                        )}
                        <div className="modal-header" style={{ position: 'relative' }}>
                            <button
                                onClick={() => { if (!isFollowUpApplying) { setShowFollowUpModal(false); setFollowUpQueue([]); } }}
                                aria-label="Close"
                                className="modal-close"
                                style={{ position: 'absolute', right: '12px', top: '10px', background: 'transparent', border: 'none', fontSize: '20px', cursor: 'pointer', zIndex: 10 }}
                                disabled={isFollowUpApplying}
                            >×</button>
                            <h3>🔁 Apply to Other Groups?</h3>
                            <p>We've found this error in {followUpQueue.length} other group{followUpQueue.length > 1 ? 's' : ''}. Apply the same action to {followUpQueue.length > 1 ? 'these groups' : 'this group'} as well?</p>
                        </div>
                        <div className="modal-body">
                            <div style={{ marginBottom: '0.75rem', color: '#4a5568' }}>
                                Action: <strong>{followUpAction === 'fix' ? 'Apply Fix' : 'Mark Not An Issue'}</strong>
                            </div>
                            <div className="similar-cells-inline" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                {followUpQueue.slice(0, 6).map(g => (
                                    <span key={g.signature} className="cell-reference">{g.sampleIssue?.cellReference || `${g.sampleIssue?.column}${g.sampleIssue?.row}`}</span>
                                ))}
                                {followUpQueue.length > 6 && (
                                    <span className="more-cells">+{followUpQueue.length - 6} more</span>
                                )}
                            </div>
                        </div>
                        <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                            <button className="btn btn-secondary" onClick={() => { setShowFollowUpModal(false); setFollowUpQueue([]); }} disabled={isFollowUpApplying}>Cancel</button>
                            <button className="btn btn-primary" onClick={handleFollowUpApply} disabled={isFollowUpApplying}>OK</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Not An Issue Modal */}
            {showNotIssueModal && (
                <div className="modal-overlay">
                    <div className="modal-content bulk-override-modal">
                        {isNotIssueApplying && (
                            <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.7)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 20 }}>
                                <div style={{ width: 36, height: 36, border: '4px solid #cbd5e0', borderTopColor: '#48bb78', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                                <div style={{ marginTop: '0.75rem', color: '#4a5568' }}>Applying your choice…</div>
                            </div>
                        )}
                        <div className="modal-header" style={{ position: 'relative' }}>
                            <button
                                onClick={handleNotIssueCancel}
                                aria-label="Close"
                                className="modal-close"
                                style={{ position: 'absolute', right: '12px', top: '10px', background: 'transparent', border: 'none', fontSize: '20px', cursor: 'pointer', zIndex: 10 }}
                                disabled={isNotIssueApplying}
                            >×</button>
                            <h3>✅ Mark as Not An Issue?</h3>
                            <p>
                                {notIssueData.char
                                    ? `We will whitelist character "${notIssueData.char}" and apply to similar cells.`
                                    : 'We will keep the current value and apply to similar cells.'}
                            </p>
                        </div>

                        <div className="modal-body">
                            <div className="override-comparison">
                                <div className="override-section">
                                    <label>Original Value:</label>
                                    <div className="value-display original-value">
                                        {notIssueData.currentIssue?.originalValue}
                                    </div>
                                </div>
                                <div className="override-section">
                                    <label>Suggested Fix (will be ignored):</label>
                                    <div className="value-display suggested-value">
                                        {notIssueData.currentIssue?.suggestedFix}
                                    </div>
                                </div>
                            </div>

                            <div className="similar-cells-info">
                                <div className="similar-cells-inline">
                                    <span className="similar-cells-label"><strong>Similar cells found:</strong></span>
                                    <div className="similar-cells-list">
                                        {notIssueData.similarIssues.slice(0, 5).map(issue => (
                                            <span key={issue.id} className="cell-reference">
                                                {issue.cellReference || `${issue.column}${issue.row}`}
                                            </span>
                                        ))}
                                        {notIssueData.similarIssues.length > 5 && (
                                            <span className="more-cells">
                                                +{notIssueData.similarIssues.length - 5} more
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="modal-question">
                                <p><strong>Do you want to apply Not An Issue to all similar cells?</strong></p>
                            </div>
                        </div>

                        <div className="modal-actions">
                            <button onClick={handleNotIssueConfirm} className="btn btn-primary" disabled={isNotIssueApplying}>{isNotIssueApplying ? 'Applying…' : '✅ Yes, Apply to All'}</button>
                            <button onClick={handleNotIssueSingle} className="btn btn-secondary" disabled={isNotIssueApplying}>❌ No, Just This One</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Fix All overlay */}
            {isFixAllApplying && (
                <div className="modal-overlay">
                    <div className="modal-content bulk-override-modal">
                        <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.7)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 20 }}>
                            <div style={{ width: 36, height: 36, border: '4px solid #cbd5e0', borderTopColor: '#667eea', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                            <div style={{ marginTop: '0.75rem', color: '#4a5568' }}>
                                Applying {fixAllCompleted.toLocaleString()}/{fixAllTotal.toLocaleString()}...
                            </div>
                        </div>
                        <div className="modal-header" style={{ position: 'relative' }}>
                            <h3>🔄 Fixing All Issues…</h3>
                            <p>This will run through all remaining issues in pages of 20,000.</p>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
};

export default ReportDisplay; 