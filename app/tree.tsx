import { FeatureTooltip } from '@/components/FeatureTooltip';
import { SideTray } from '@/components/SideTray';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { TreeNode } from '@/components/tree/TreeNode';
import { ZoomPanContainer } from '@/components/ZoomPanContainer';
import { Layout } from '@/constants/theme';
import { useThemeColor } from '@/hooks/useThemeColor';
import { FamilyService } from '@/services/familyService';
import { Member } from '@/types/family';
import { findMemberNested, findPathToMember, reciprocalRelation, updateNestedMember } from '@/utils/familyUtils';
import { calculateTreeLayout } from '@/utils/treeLayout';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import JSZip from 'jszip';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Dimensions, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

export default function TreeScreen() {
  const router = useRouter();
  const { focusId: focusIdParam } = useLocalSearchParams<{ focusId?: string }>();
  const [members, setMembers] = useState<Member[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [activeMemberId, setActiveMemberId] = useState<string | null>(null);
  const [expandedNodeId, setExpandedNodeId] = useState<string | null>(null);
  const [activeUserId, setActiveUserId] = useState<string | null>(null);
  const [pinnedMemberId, setPinnedMemberId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [leftTrayOpen, setLeftTrayOpen] = useState(false);
  const [rightTrayOpen, setRightTrayOpen] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [focusStack, setFocusStack] = useState<string[]>([]);
  const [linkedSubtrees, setLinkedSubtrees] = useState<Record<string, string>>({});
  const [relationSearchQuery, setRelationSearchQuery] = useState('');
  const bgColor = useThemeColor({}, 'background');
  const cardColor = useThemeColor({}, 'card');
  const borderColor = useThemeColor({}, 'border');
  const textColor = useThemeColor({}, 'text');
  const tint = useThemeColor({}, 'tint');

  const focusMemberId = focusStack.length > 0 ? focusStack[focusStack.length - 1] : null;

  const activeUser = useMemo(() => {
    const id = pinnedMemberId || activeUserId;
    if (!id) return undefined;
    return findMemberNested(members, id);
  }, [members, activeUserId, pinnedMemberId]);

  const selectedMember = useMemo(() => {
    if (!selectedMemberId) return undefined;
    return findMemberNested(members, selectedMemberId);
  }, [members, selectedMemberId]);

  const visibleMembers = useMemo(() => {
    if (!focusMemberId) {
      // Main tree: show only top-level members
      return members;
    }
    // Subtree: show the anchor member PLUS their direct subTree members
    const anchor = findMemberNested(members, focusMemberId);
    if (!anchor) return [];
    
    // We only show the anchor and their IMMEDIATE subTree members to isolate nested subtrees
    return [anchor, ...(anchor.subTree || [])];
  }, [members, focusMemberId]);

  useEffect(() => {
    if (focusIdParam && members.length > 0) {
      const path = findPathToMember(members, focusIdParam);
      if (path) {
        setFocusStack(path);
        // Clear the param so it doesn't re-trigger if we navigate back/forth
        router.setParams({ focusId: undefined });
      }
    }
  }, [focusIdParam, members, router]);

  const [relationModal, setRelationModal] = useState<{
    open: boolean;
    sourceId: string | null;
    type: 'child' | 'spouse' | 'sibling' | 'parent' | 'partner' | null;
  }>({ open: false, sourceId: null, type: null });
  const [useNewTarget, setUseNewTarget] = useState(true);
  const [newTargetName, setNewTargetName] = useState('');
  const [newTargetSex, setNewTargetSex] = useState<'Male' | 'Female' | 'Other'>('Male');
  const [newTargetDob, setNewTargetDob] = useState('');
  const [showDobPicker, setShowDobPicker] = useState(false);
  const [tempDob, setTempDob] = useState<Date>(new Date());
  const [targetId, setTargetId] = useState<string | null>(null);

  const [exportOpen, setExportOpen] = useState(false);
  const [exportText, setExportText] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [currentZoom, setCurrentZoom] = useState(1);
  const [currentTransform, setCurrentTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [viewportBounds, setViewportBounds] = useState({ x: 0, y: 0, width: SCREEN_W, height: SCREEN_H });
  const [visibleNodeIds, setVisibleNodeIds] = useState<Set<string>>(new Set());
  const [containerDims, setContainerDims] = useState({ width: SCREEN_W, height: SCREEN_H - 240 });
  const [toast, setToast] = useState<string | null>(null);
  const [showSubtreeTip, setShowSubtreeTip] = useState(false);
  const toastsRef = useRef<string[]>([]);
  const toastActiveRef = useRef(false);
  const backdropAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(backdropAnim, {
      toValue: expandedNodeId ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [expandedNodeId, backdropAnim]);

  const enqueueToast = useCallback((msg: string) => {
    if (!toastActiveRef.current) {
      toastActiveRef.current = true;
      setToast(msg);
      setTimeout(() => {
        setToast(null);
        const processNext = () => {
          const next = toastsRef.current.shift();
          if (next) {
            setToast(next);
            setTimeout(() => {
              setToast(null);
              processNext();
            }, 1800);
          } else {
            toastActiveRef.current = false;
          }
        };
        processNext();
      }, 1800);
    } else {
      toastsRef.current.push(msg);
    }
  }, []);

  const zoomPanContainerRef = useRef<any>(null);
  const autoHideMs = 3000;
  const expandTimerRef = useRef<number | null>(null);
  const clearExpandTimer = () => {
    if (expandTimerRef.current) {
      clearTimeout(expandTimerRef.current as any);
      expandTimerRef.current = null;
    }
  };

  useEffect(() => {
    clearExpandTimer();
    if (expandedNodeId) {
      expandTimerRef.current = setTimeout(() => {
        setExpandedNodeId(null);
        expandTimerRef.current = null;
      }, autoHideMs) as unknown as number;
    }
    return () => clearExpandTimer();
  }, [expandedNodeId]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpandedNodeId(null);
    };
    if (expandedNodeId) window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [expandedNodeId]);

  const ensureDefaultMember = useCallback(async (list: Member[]) => {
    if (list.length > 0) return list;

    const me: Member = {
      id: `${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      name: 'Me',
      relations: [],
    };

    const next = [me];
    await FamilyService.saveFamily(next);
    return next;
  }, []);

  const loadMembers = useCallback(async () => {
    const list = await FamilyService.getFamily();
    const ensured = await ensureDefaultMember(list);
    
    // Only update if data actually changed to prevent layout recalculation loops
    setMembers(prev => {
      if (JSON.stringify(prev) === JSON.stringify(ensured)) return prev;
      return ensured;
    });
    
    const pinnedId = await FamilyService.getPinnedMemberId();
    setPinnedMemberId(pinnedId);
    
    // Prioritize pinned member for active user (header icon)
    if (pinnedId && findMemberNested(ensured, pinnedId)) {
      setActiveUserId(pinnedId);
      await AsyncStorage.setItem('activeUserId', pinnedId);
    } else {
      const savedActiveId = await AsyncStorage.getItem('activeUserId');
      if (savedActiveId && findMemberNested(ensured, savedActiveId)) {
        setActiveUserId(savedActiveId);
      } else if (ensured.length > 0) {
        setActiveUserId(ensured[0].id);
        await AsyncStorage.setItem('activeUserId', ensured[0].id);
      }
    }

    setActiveMemberId(null);
    if (ensured.length <= 1) setIsEditing(false);

    const links = await FamilyService.getLinkedSubtrees();
    setLinkedSubtrees(links);

    // Check if user has seen the subtree tip
    const hasSeenTip = await FamilyService.hasSeenSubtreeTip();
    if (!hasSeenTip && ensured.length > 0) {
      // Check if there are any members with subtrees
      const hasSubtrees = ensured.some(m => m.subTree && m.subTree.length > 0);
      if (hasSubtrees) {
        setTimeout(() => setShowSubtreeTip(true), 1500);
      }
    }
  }, [ensureDefaultMember, findMemberNested]);

  const filteredMembers = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase();
    
    const allMembersMap = new Map<string, Member>();
    const flatten = (list: Member[]) => {
      list.forEach(m => {
        if (!allMembersMap.has(m.id)) {
          allMembersMap.set(m.id, m);
        }
        if (m.subTree) flatten(m.subTree);
      });
    };
    flatten(members);

    return Array.from(allMembersMap.values()).filter(m => 
      m.name.toLowerCase().includes(query)
    ).slice(0, 5);
  }, [members, searchQuery]);

  const normalizeImportedFamily = useCallback((data: unknown): Member[] | null => {
    const rawList: any[] = Array.isArray(data)
      ? data
      : (data && typeof data === 'object' && Array.isArray((data as any).members))
        ? (data as any).members
        : [];

    if (!Array.isArray(rawList)) return null;

    const seen = new Set<string>();
    const sanitized: Member[] = [];

    for (const item of rawList) {
      if (!item || typeof item !== 'object') continue;
      const id = (item as any).id;
      const name = (item as any).name;
      if (typeof id !== 'string' || !id.trim()) continue;
      if (typeof name !== 'string' || !name.trim()) continue;
      if (seen.has(id)) continue;
      seen.add(id);

      const dob = typeof (item as any).dob === 'string' ? (item as any).dob : undefined;
      const dod = typeof (item as any).dod === 'string' ? (item as any).dod : undefined;
      const sex = typeof (item as any).sex === 'string' ? (item as any).sex : undefined;
      const age = typeof (item as any).age === 'number' ? (item as any).age : undefined;
      const email = typeof (item as any).email === 'string' ? (item as any).email : undefined;
      const photo = typeof (item as any).photo === 'string' ? (item as any).photo : undefined;
      const notes = typeof (item as any).notes === 'string' ? (item as any).notes : undefined;
      const subTreeRaw = (item as any).subTree;
      const subTree = Array.isArray(subTreeRaw) ? normalizeImportedFamily(subTreeRaw) || undefined : undefined;

      const relationsRaw = (item as any).relations;
      const relations = Array.isArray(relationsRaw)
        ? relationsRaw
            .filter((r: any) => r && typeof r === 'object')
            .map((r: any) => ({
              type: typeof r.type === 'string' ? r.type : 'other',
              targetId: typeof r.targetId === 'string' ? r.targetId : '',
            }))
            .filter((r: any) => r.targetId && r.targetId !== id)
        : [];

      sanitized.push({ 
        id, 
        name: name.trim(), 
        dob, 
        dod, 
        sex, 
        age, 
        email, 
        photo, 
        notes, 
        subTree, 
        relations 
      });
    }

    if (sanitized.length === 0) return [];

    // Drop relations that reference missing members.
    // We need to collect all IDs from the entire nested structure.
    const getAllIds = (list: Member[]): string[] => {
      let ids: string[] = [];
      list.forEach(m => {
        ids.push(m.id);
        if (m.subTree) ids = ids.concat(getAllIds(m.subTree));
      });
      return ids;
    };

    const idSet = new Set(getAllIds(sanitized));

    const filterRelations = (list: Member[]): Member[] => {
      return list.map((m) => ({
        ...m,
        relations: (m.relations || []).filter((r) => idSet.has(r.targetId)),
        subTree: m.subTree ? filterRelations(m.subTree) : undefined,
      }));
    };

    return filterRelations(sanitized);
  }, []);

  const openExportModal = useCallback(() => {
    setExportText(JSON.stringify(members, null, 2));
    setExportOpen(true);
  }, [members]);

  const exportToFile = useCallback(async () => {
    try {
      const zip = new JSZip();
      
      // 1. Add the main tree JSON
      zip.file('tree.json', JSON.stringify(members, null, 2));

      // 2. Add profile photos
      const photosFolder = zip.folder('photos');
      if (photosFolder) {
        for (const member of members) {
          if (member.photo && member.photo.startsWith('file://')) {
            try {
              const base64 = await FileSystem.readAsStringAsync(member.photo, {
                encoding: FileSystem.EncodingType.Base64,
              });
              // Use member ID to keep it unique
              photosFolder.file(`${member.id}/profile.jpg`, base64, { base64: true });
            } catch (err) {
              console.warn(`Could not include photo for ${member.name}:`, err);
            }
          }
        }
      }

      const base64Zip = await zip.generateAsync({ type: 'base64' });

      const baseDir = FileSystem.cacheDirectory || (FileSystem as any).documentDirectory;
      if (!baseDir) {
        openExportModal();
        return;
      }

      const safeStamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileUri = `${baseDir}family-tree-${safeStamp}.zip`;
      await FileSystem.writeAsStringAsync(fileUri, base64Zip, { encoding: FileSystem.EncodingType.Base64 });

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'application/zip',
          dialogTitle: 'Export (ZIP)',
        });
      } else {
        openExportModal();
        Alert.alert('Sharing not available', 'Sharing is not available on this device. Copy the JSON from the export modal instead.');
      }
    } catch (error) {
      console.error('Export failed:', error);
      openExportModal();
      Alert.alert('Export failed', 'Could not create the ZIP file. Falling back to JSON copy.');
    }
  }, [members, openExportModal]);

  const exportToZipWeb = useCallback(async () => {
    try {
      const zip = new JSZip();
      zip.file('tree.json', JSON.stringify(members, null, 2));
      
      const photosFolder = zip.folder('photos');
      if (photosFolder) {
        for (const member of members) {
          if (member.photo) {
            try {
              if (member.photo.startsWith('data:image')) {
                const base64Data = member.photo.split(',')[1];
                photosFolder.file(`${member.id}/profile.jpg`, base64Data, { base64: true });
              } else if (member.photo.startsWith('http') || member.photo.startsWith('blob:')) {
                const response = await fetch(member.photo);
                const blob = await response.blob();
                photosFolder.file(`${member.id}/profile.jpg`, blob);
              }
            } catch (err) {
              console.warn(`Could not include photo for ${member.name}:`, err);
            }
          }
        }
      }

      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const link = document.createElement('a');
      link.href = url;
      link.download = `family-tree-${new Date().getTime()}.zip`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Web export failed:', error);
      Alert.alert('Export failed', 'Could not create the ZIP file.');
    }
  }, [members]);

  const handleExportPress = useCallback(() => {
    if (Platform.OS === 'web') {
      openExportModal();
      return;
    }

    Alert.alert('Export', 'Choose export method', [
      { text: 'ZIP File', onPress: () => void exportToFile() },
      { text: 'Copy JSON', onPress: openExportModal },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [exportToFile, openExportModal]);

  const closeExport = useCallback(() => {
    setExportOpen(false);
  }, []);

  const importFromJsonText = useCallback(
    async (text: string) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        Alert.alert('Invalid JSON', 'Please provide a valid JSON export.');
        return;
      }

      const next = normalizeImportedFamily(parsed);
      if (next === null) {
        Alert.alert('Invalid format', 'Expected a JSON array of members (or an object with a "members" array).');
        return;
      }

      const ensured = await ensureDefaultMember(next);
      await FamilyService.saveFamily(ensured);
      setMembers(ensured);
      setIsEditing(false);
      setActiveMemberId(null);
      Alert.alert('Imported', 'Family tree imported successfully.');
    },
    [ensureDefaultMember, normalizeImportedFamily]
  );

  const importFromZip = useCallback(async (uri: string) => {
    try {
      let zipData: any;
      if (Platform.OS === 'web') {
        const response = await fetch(uri);
        zipData = await response.blob();
      } else {
        const base64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        zipData = base64;
      }

      const zip = await JSZip.loadAsync(zipData, { base64: Platform.OS !== 'web' });
      
      // 1. Read tree.json
      const treeFile = zip.file('tree.json');
      if (!treeFile) {
        Alert.alert('Invalid ZIP', 'The ZIP file does not contain tree.json.');
        return;
      }
      const treeJson = await treeFile.async('string');
      const parsed = JSON.parse(treeJson);
      const next = normalizeImportedFamily(parsed);
      if (!next) {
        Alert.alert('Invalid format', 'The tree.json in the ZIP is invalid.');
        return;
      }

      // 2. Extract photos
      const updatedMembers = [...next];

      if (Platform.OS !== 'web') {
        const photosDir = `${FileSystem.documentDirectory}photos/`;
        await FileSystem.makeDirectoryAsync(photosDir, { intermediates: true }).catch(() => {});

        for (let i = 0; i < updatedMembers.length; i++) {
          const m = updatedMembers[i];
          const photoFile = zip.file(`photos/${m.id}/profile.jpg`);
          if (photoFile) {
            const photoBase64 = await photoFile.async('base64');
            const localPhotoUri = `${photosDir}${m.id}_profile.jpg`;
            await FileSystem.writeAsStringAsync(localPhotoUri, photoBase64, {
              encoding: FileSystem.EncodingType.Base64,
            });
            updatedMembers[i] = { ...m, photo: localPhotoUri };
          }
        }
      } else {
        // Web: Convert photos to base64 data URIs for storage
        for (let i = 0; i < updatedMembers.length; i++) {
          const m = updatedMembers[i];
          const photoFile = zip.file(`photos/${m.id}/profile.jpg`);
          if (photoFile) {
            const photoBase64 = await photoFile.async('base64');
            updatedMembers[i] = { ...m, photo: `data:image/jpeg;base64,${photoBase64}` };
          }
        }
      }

      const ensured = await ensureDefaultMember(updatedMembers);
      await FamilyService.saveFamily(ensured);
      setMembers(ensured);
      setIsEditing(false);
      setActiveMemberId(null);
      Alert.alert('Imported', 'Family tree and photos imported successfully.');
    } catch (error) {
      console.error('Import failed:', error);
      Alert.alert('Import failed', 'Could not process the ZIP file.');
    }
  }, [ensureDefaultMember, normalizeImportedFamily]);

  const openImportModal = useCallback(() => {
    setImportText('');
    setImportOpen(true);
  }, []);

  const importFromFile = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/json', 'text/json', 'text/plain', 'application/zip'],
      copyToCacheDirectory: true,
      multiple: false,
    });

    if (result.canceled) return;
    const asset = result.assets?.[0];
    if (!asset || !asset.uri) {
      Alert.alert('Import failed', 'No file was selected.');
      return;
    }

    if (asset.name.toLowerCase().endsWith('.zip')) {
      await importFromZip(asset.uri);
    } else {
      try {
        let text = '';
        if (Platform.OS === 'web') {
          const response = await fetch(asset.uri);
          text = await response.text();
        } else {
          text = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.UTF8 });
        }
        await importFromJsonText(text);
      } catch (err) {
        console.error('Import error:', err);
        Alert.alert('Import failed', 'Could not read the selected file.');
      }
    }
  }, [importFromJsonText, importFromZip]);

  const handleImportPress = useCallback(() => {
    if (Platform.OS === 'web') {
      openImportModal();
      return;
    }

    Alert.alert('Import', 'Choose import method', [
      {
        text: 'File',
        onPress: () => {
          void (async () => {
            try {
              await importFromFile();
            } catch {
              openImportModal();
              Alert.alert('Import failed', 'Could not read the selected file. You can paste JSON in the import modal instead.');
            }
          })();
        },
      },
      { text: 'Copy/Paste', onPress: openImportModal },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [importFromFile, openImportModal]);

  const closeImport = useCallback(() => {
    setImportOpen(false);
  }, []);

  const handleImport = useCallback(async () => {
    await importFromJsonText(importText);
    closeImport();
  }, [closeImport, importFromJsonText, importText]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  useFocusEffect(
    useCallback(() => {
      loadMembers();
    }, [loadMembers])
  );

  const activeMemberIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeMemberIdRef.current = activeMemberId;
  }, [activeMemberId]);

  const handleReset = async () => {
    const performReset = async () => {
      await FamilyService.resetFamily();
      setIsEditing(false);
      setActiveMemberId(null);
      const ensured = await ensureDefaultMember([]);
      setMembers(ensured);
      Alert.alert('Success', 'All family data has been cleared.');
    };

    if (Platform.OS === 'web') {
      if (confirm('Are you sure you want to clear all family data?')) {
        performReset();
      }
      return;
    }

    Alert.alert('Reset Data', 'Clear all family data?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: performReset }
    ]);
  };

  const layout = useMemo(() => {
    try {
      return calculateTreeLayout(visibleMembers, SCREEN_W, focusMemberId);
    } catch (err) {
      console.error('Layout calculation failed:', err);
      return { layers: [], positions: {}, edges: [], spouseEdges: [] };
    }
  }, [visibleMembers, focusMemberId]);

  const { positions, edges, spouseEdges } = layout;

  const { centeredPositions, contentWidth, contentHeight, virtualWidth, virtualHeight } = useMemo(() => {
    const nodeW = Layout.nodeWidth;
    const nodeH = Layout.nodeHeight;
    const pad = 200; // Reduced padding to keep tree closer to start
    const pts = Object.values(positions);
    if (!pts.length) {
      return { centeredPositions: positions, contentWidth: SCREEN_W, contentHeight: 800 };
    }
    const minX = Math.min(...pts.map((p) => p.x));
    const maxX = Math.max(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y));
    const maxY = Math.max(...pts.map((p) => p.y));
    
    const layoutWidth = isFinite(maxX - minX) ? maxX - minX + nodeW : SCREEN_W;
    const layoutHeight = isFinite(maxY - minY) ? maxY - minY + nodeH : 800;
    
    // Virtual dimensions represent the full logical tree size (unlimited)
    const virtualWidth = layoutWidth + pad * 2;
    const virtualHeight = Math.max(800, layoutHeight + pad);
    
    // Render dimensions - no longer capped at 4000px as we use individual SVGs
    const width = Math.max(SCREEN_W, virtualWidth);
    const height = Math.max(800, virtualHeight);
    
    // Offset to center the layout within the contentWidth
    const offsetX = isFinite(minX) ? pad - minX : pad;
    const offsetY = isFinite(minY) ? 60 - minY : 60; // align to top with some padding
    
    const shifted: typeof positions = {};
    Object.entries(positions).forEach(([id, p]) => {
      shifted[id] = { x: p.x + offsetX, y: p.y + offsetY };
    });
    return { 
      centeredPositions: shifted, 
      contentWidth: width, 
      contentHeight: height,
      // Pass virtual dimensions for proper panning bounds
      virtualWidth,
      virtualHeight
    };
  }, [positions]);

  // Viewport-based culling with generous buffer for smooth scrolling
  useEffect(() => {
    if (!centeredPositions || Object.keys(centeredPositions).length === 0) {
      setVisibleNodeIds(new Set());
      return;
    }
    
    const buffer = 500; // Extra buffer around viewport
    const visibleIds = new Set<string>();
    
    Object.entries(centeredPositions).forEach(([id, pos]) => {
      const nodeRight = pos.x + Layout.nodeWidth;
      const nodeBottom = pos.y + Layout.nodeHeight;
      
      // Check if node intersects with buffered viewport
      if (nodeRight >= viewportBounds.x - buffer && 
          pos.x <= viewportBounds.x + viewportBounds.width + buffer &&
          nodeBottom >= viewportBounds.y - buffer && 
          pos.y <= viewportBounds.y + viewportBounds.height + buffer) {
        visibleIds.add(id);
      }
    });
    
    setVisibleNodeIds(visibleIds);
  }, [centeredPositions, viewportBounds]);

  // Viewport-based edge culling
  const isEdgeVisible = useCallback((fromId: string, toId: string, parent2Id?: string) => {
    const a = centeredPositions[fromId];
    const b = centeredPositions[toId];
    if (!a || !b) return false;
    
    const buffer = 500;
    let minX = Math.min(a.x, b.x);
    let maxX = Math.max(a.x, b.x) + Layout.nodeWidth;
    let minY = Math.min(a.y, b.y);
    let maxY = Math.max(a.y, b.y) + Layout.nodeHeight;
    
    if (parent2Id) {
      const p2 = centeredPositions[parent2Id];
      if (p2) {
        minX = Math.min(minX, p2.x);
        maxX = Math.max(maxX, p2.x + Layout.nodeWidth);
      }
    }
    
    return (
      maxX >= viewportBounds.x - buffer &&
      minX <= viewportBounds.x + viewportBounds.width + buffer &&
      maxY >= viewportBounds.y - buffer &&
      minY <= viewportBounds.y + viewportBounds.height + buffer
    );
  }, [centeredPositions, viewportBounds]);

  const handleResetZoomPan = useCallback(() => {
    zoomPanContainerRef.current?.reset();
  }, []);

  const edgeColors = useMemo(() => {
    const palette = ['#FF2D55', '#FF9500', '#FFCC00', '#34C759', '#5AC8FA', '#0A84FF', '#5856D6', '#AF52DE'];
    const map = new Map<string, string>();
    edges.forEach((e) => {
      const key = e.isJoint && e.parent2 ? [e.from, e.parent2].sort().join('|') : e.from;
      if (!map.has(key)) {
        const color = palette[map.size % palette.length];
        map.set(key, color);
      }
    });
    return map;
  }, [edges]);

  const openRelationModal = useCallback((sourceId: string, type: 'child' | 'spouse' | 'sibling' | 'parent') => {
    setRelationModal({ open: true, sourceId, type });
    setUseNewTarget(true);
    setNewTargetName('');
    setNewTargetSex('Male');
    setNewTargetDob('');
    setTargetId(null);
  }, []);

  const handleSelectMember = useCallback((id: string) => {
    setSelectedMemberId(id);
    setRightTrayOpen(true);
    setActiveMemberId(id);
  }, []);

  const closeRelationModal = useCallback(() => {
    setRelationModal({ open: false, sourceId: null, type: null });
    setUseNewTarget(true);
    setNewTargetName('');
    setNewTargetSex('Male');
    setNewTargetDob('');
    setTargetId(null);
    setShowDobPicker(false);
    setExpandedNodeId(null);
    setRelationSearchQuery('');
  }, []);

  const handleOpenDobPicker = () => {
    const base = newTargetDob ? new Date(newTargetDob) : new Date();
    setTempDob(isNaN(base.getTime()) ? new Date() : base);
    setShowDobPicker(true);
  };

  const onDobChange = (event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      if (event.type === 'set' && selectedDate) {
        setTempDob(selectedDate);
        const y = selectedDate.getFullYear();
        const m = String(selectedDate.getMonth() + 1).padStart(2, '0');
        const d = String(selectedDate.getDate()).padStart(2, '0');
        setNewTargetDob(`${m}/${d}/${y}`);
        setShowDobPicker(false);
      } else if (event.type === 'dismissed') {
        setShowDobPicker(false);
      }
    } else {
      if (selectedDate) {
        setTempDob(selectedDate);
      }
    }
  };

  const handleConfirmDob = () => {
    if (!tempDob) {
      setShowDobPicker(false);
      return;
    }
    const m = String(tempDob.getMonth() + 1).padStart(2, '0');
    const d = String(tempDob.getDate()).padStart(2, '0');
    const y = tempDob.getFullYear();
    setNewTargetDob(`${m}/${d}/${y}`);
    setShowDobPicker(false);
  };

  const handleDateInputChange = (text: string, setter: (val: string) => void) => {
    let cleaned = text.replace(/\D/g, '');
    cleaned = cleaned.substring(0, 8);
    let formatted = cleaned;
    if (cleaned.length > 2) {
      formatted = cleaned.substring(0, 2) + '/' + cleaned.substring(2);
    }
    if (cleaned.length > 4) {
      formatted = formatted.substring(0, 5) + '/' + formatted.substring(5);
    }
    setter(formatted);
  };

  const saveQuickRelation = useCallback(async () => {
    try {
      if (!relationModal.open || !relationModal.sourceId || !relationModal.type) return;

      const sourceId = relationModal.sourceId;
      const type = relationModal.type;
      
      // Haptic on save (mobile)
      try { 
        if (Platform.OS !== 'web') await (await import('expo-haptics')).notificationAsync((await import('expo-haptics')).NotificationFeedbackType.Success);
      } catch {}

      const addRelationPair = (currentList: Member[], id1: string, id2: string, type1to2: string): Member[] => {
        let next = updateNestedMember(currentList, id1, (m1) => {
          const relations = [...(m1.relations || [])];
          if (!relations.find((r) => r.targetId === id2 && r.type === type1to2)) {
            relations.push({ type: type1to2, targetId: id2 });
          }
          return { ...m1, relations };
        });

        next = updateNestedMember(next, id2, (m2) => {
          const relations = [...(m2.relations || [])];
          const type2to1 = reciprocalRelation(type1to2);
          if (!relations.find((r) => r.targetId === id1 && r.type === type2to1)) {
            relations.push({ type: type2to1, targetId: id1 });
          }
          return { ...m2, relations };
        });
        
        return next;
      };

      let finalTargetId: string | null = targetId;
      let updatedList = [...members];

      if (useNewTarget) {
        if (!newTargetName.trim()) {
          Alert.alert('Name required', 'Enter a name to create the new member.');
          return;
        }
        finalTargetId = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
        const newMember: Member = { 
          id: finalTargetId, 
          name: newTargetName.trim(), 
          sex: newTargetSex,
          dob: newTargetDob,
          relations: [] 
        };

        if (focusMemberId) {
          // Add to the spouse's subTree immutably
          updatedList = updateNestedMember(members, focusMemberId, (spouse) => ({
            ...spouse,
            subTree: [...(spouse.subTree || []), newMember]
          }));
        } else {
          // Add to main tree
          updatedList = [...members, newMember];
        }
      } else if (focusMemberId && finalTargetId) {
        // CRITICAL: Prevent circular references which cause crashes during JSON.stringify
        if (finalTargetId === focusMemberId) {
          Alert.alert('Invalid', 'A member cannot be added to their own subtree.');
          return;
        }

        // If selecting an existing member while in a spouse tree, 
        // add a reference node to that spouse's subTree if they aren't already visible there.
        const isAlreadyVisible = visibleMembers.some(m => m.id === finalTargetId);
        if (!isAlreadyVisible) {
          const existing = findMemberNested(members, finalTargetId);
          if (existing) {
            // Create a reference node. We copy basic info so it renders correctly.
            // We don't copy the subTree to avoid deep duplication/cycles, but we keep relations
            // so they can be updated in sync.
            const referenceNode: Member = {
              ...existing,
              subTree: [] 
            };
            updatedList = updateNestedMember(updatedList, focusMemberId, (spouse) => ({
              ...spouse,
              subTree: [...(spouse.subTree || []), referenceNode]
            }));
          }
        }
      }

      if (!finalTargetId) {
        Alert.alert('Select member', 'Pick an existing member or create a new one.');
        return;
      }
      if (finalTargetId === sourceId) {
        Alert.alert('Invalid', 'Cannot relate to self.');
        return;
      }

      updatedList = addRelationPair(updatedList, sourceId, finalTargetId, type);

      if (type === 'child') {
        const sourceMember = findMemberNested(updatedList, sourceId);
        // 1. Joint parenting: Add child to spouse as well
        const spouseRel = sourceMember?.relations?.find((r) => r.type === 'spouse' || r.type === 'partner');
        if (spouseRel) {
          updatedList = addRelationPair(updatedList, spouseRel.targetId, finalTargetId, 'child');
        }
        
        // 2. Sibling auto-linking: New child should be sibling to all existing children of this parent
        const otherChildren = (sourceMember?.relations || []).filter(r => r.type === 'child' && r.targetId !== finalTargetId);
        otherChildren.forEach(c => {
          updatedList = addRelationPair(updatedList, finalTargetId!, c.targetId, 'sibling');
        });
      } else if (type === 'spouse' || type === 'partner') {
        const sourceMember = findMemberNested(updatedList, sourceId);
        const childrenRels = (sourceMember?.relations || []).filter((r) => r.type === 'child');
        childrenRels.forEach((c) => {
          updatedList = addRelationPair(updatedList, finalTargetId!, c.targetId, 'child');
        });
      } else if (type === 'parent') {
        const sourceMember = findMemberNested(updatedList, sourceId);
        // 1. Connect parent to all siblings of sourceMember
        const siblingRels = (sourceMember?.relations || []).filter((r) => r.type === 'sibling');
        siblingRels.forEach((s) => {
          updatedList = addRelationPair(updatedList, finalTargetId!, s.targetId, 'child');
        });
        
        // 2. If the new parent has a spouse/partner, they should also be a parent to sourceMember and siblings
        const parentMember = findMemberNested(updatedList, finalTargetId!);
        const spouseRel = parentMember?.relations?.find((r) => r.type === 'spouse' || r.type === 'partner');
        if (spouseRel) {
          updatedList = addRelationPair(updatedList, spouseRel.targetId, sourceId, 'child');
          siblingRels.forEach((s) => {
            updatedList = addRelationPair(updatedList, spouseRel.targetId, s.targetId, 'child');
          });
        }
      } else if (type === 'sibling') {
        const sourceMember = findMemberNested(updatedList, sourceId);
        // 1. New sibling should share the same parents
        const parentRels = (sourceMember?.relations || []).filter(r => r.type === 'parent');
        parentRels.forEach(p => {
          updatedList = addRelationPair(updatedList, finalTargetId!, p.targetId, 'parent');
        });
        
        // 2. New sibling should also be a sibling to all existing siblings
        const otherSiblings = (sourceMember?.relations || []).filter(r => r.type === 'sibling' && r.targetId !== finalTargetId);
        otherSiblings.forEach(s => {
          updatedList = addRelationPair(updatedList, finalTargetId!, s.targetId, 'sibling');
        });
      }

      // Automatic linking: if adding a relation within a subtree, link the new/linked member to the subtree anchor
      if (focusMemberId && finalTargetId) {
        if (linkedSubtrees[focusMemberId]) {
          // Recursive linking prevention: focusMemberId is already linked to another anchor.
          // We don't link finalTargetId to focusMemberId to avoid A -> B -> C chains.
          console.log(`Skipping automatic link for ${finalTargetId} because anchor ${focusMemberId} is already linked.`);
        } else if (linkedSubtrees[finalTargetId]) {
          // finalTargetId is already linked to something else. 
          // We don't overwrite it automatically to avoid confusion.
          console.log(`Skipping automatic link for ${finalTargetId} because it is already linked to another anchor.`);
        } else {
          await FamilyService.setLink(finalTargetId, focusMemberId);
          setLinkedSubtrees(prev => ({ ...prev, [finalTargetId!]: focusMemberId }));
        }
      }

      await FamilyService.saveFamily(updatedList);
      setMembers(updatedList);
      closeRelationModal();

      // show toast (queued)
      enqueueToast('Relation saved');
    } catch (err) {
      console.error('Failed to save relation:', err);
      Alert.alert('Error', 'An unexpected error occurred while saving the relation.');
    }
  }, [closeRelationModal, members, visibleMembers, newTargetName, relationModal, targetId, useNewTarget, newTargetSex, newTargetDob, enqueueToast, focusMemberId, findMemberNested]);

  const handleDeleteMember = useCallback(
    async (id: string) => {
      if (members.length <= 1) {
        Alert.alert('Keep one member', 'You need at least one member in your tree.');
        return;
      }

      const performDelete = async () => {
        const findAndDelete = (targetList: Member[], targetId: string): Member[] => {
          return targetList
            .filter((m) => m.id !== targetId)
            .map((m) => ({
              ...m,
              relations: (m.relations || []).filter((r) => r.targetId !== targetId),
              subTree: m.subTree ? findAndDelete(m.subTree, targetId) : undefined,
            }));
        };

        const next = findAndDelete(members, id);

        await FamilyService.saveFamily(next);
        setMembers(next);
        setActiveMemberId((prev) => (prev === id ? null : prev));

        // Cleanup links associated with this member
        const links = { ...linkedSubtrees };
        let linksChanged = false;
        if (links[id]) {
          delete links[id];
          linksChanged = true;
        }
        Object.keys(links).forEach(k => {
          if (links[k] === id) {
            delete links[k];
            linksChanged = true;
          }
        });
        if (linksChanged) {
          await FamilyService.saveLinkedSubtrees(links);
          setLinkedSubtrees(links);
        }
      };

      if (Platform.OS === 'web') {
        if (confirm('Remove this member?')) {
          await performDelete();
        }
        return;
      }

      Alert.alert('Remove member', 'Are you sure you want to delete this member?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => void performDelete() },
      ]);
    },
    [members]
  );

  const lastTransformUpdate = useRef(0);
  const lastViewportUpdate = useRef({ x: 0, y: 0, s: 0 });
  const hasInitialTransform = useRef(false);
  const onTransform = useCallback((x: number, y: number, s: number) => {
    // Always allow first transform to set initial state
    if (!hasInitialTransform.current) {
      hasInitialTransform.current = true;
      setCurrentZoom(s);
      setCurrentTransform({ x, y, scale: s });
      
      // Correct viewport calculation for scale-from-center
      const viewportWidth = containerDims.width / s;
      const viewportHeight = containerDims.height / s;
      const viewportX = -x / s + (containerDims.width / 2) * (1 - 1 / s);
      const viewportY = -y / s + (containerDims.height / 2) * (1 - 1 / s);
      
      setViewportBounds({ x: viewportX, y: viewportY, width: viewportWidth, height: viewportHeight });
      lastViewportUpdate.current = { x: viewportX, y: viewportY, s: s };
      return;
    }
    
    const now = Date.now();
    // Throttle updates to ~30fps (32ms) to prevent overwhelming the JS thread
    if (now - lastTransformUpdate.current < 32) {
      return;
    }
    lastTransformUpdate.current = now;

    setCurrentZoom(s);
    setCurrentTransform({ x, y, scale: s });
    
    // Update viewport bounds for culling
    const viewportWidth = containerDims.width / s;
    const viewportHeight = containerDims.height / s;
    const viewportX = -x / s + (containerDims.width / 2) * (1 - 1 / s);
    const viewportY = -y / s + (containerDims.height / 2) * (1 - 1 / s);
    
    // Only update viewport bounds if it moved significantly (> 10px or > 2% zoom)
    // This prevents excessive re-renders during smooth panning
    const dx = Math.abs(viewportX - lastViewportUpdate.current.x);
    const dy = Math.abs(viewportY - lastViewportUpdate.current.y);
    const ds = lastViewportUpdate.current.s === 0 ? 1 : Math.abs(s - lastViewportUpdate.current.s) / lastViewportUpdate.current.s;

    if (dx > 10 || dy > 10 || ds > 0.02) {
      setViewportBounds({ x: viewportX, y: viewportY, width: viewportWidth, height: viewportHeight });
      setCurrentTransform({ x, y, scale: s });
      lastViewportUpdate.current = { x: viewportX, y: viewportY, s: s };
    }
  }, [containerDims]);

  // Transform world coordinates to screen coordinates
  const worldToScreen = useCallback((worldX: number, worldY: number) => {
    return {
      x: worldX * currentTransform.scale + currentTransform.x,
      y: worldY * currentTransform.scale + currentTransform.y
    };
  }, [currentTransform]);

  return (
    <ThemedView style={{ flex: 1, backgroundColor: bgColor }}>
      <Stack.Screen 
        options={{ 
          headerShown: true,
          title: focusMemberId ? 'Family Subtree' : 'Family Tree',
          headerTitleAlign: 'center',
          headerLeft: () => (
            <Pressable
              onPress={() => setLeftTrayOpen(prev => !prev)}
              style={[styles.iconBtn, { marginLeft: 12, backgroundColor: cardColor, borderColor: borderColor }]}
              accessibilityLabel="Menu"
            >
              <Ionicons name="menu-outline" size={24} color={textColor} />
            </Pressable>
          ),
          headerRight: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginRight: 12 }}>
              {isEditing ? (
                <Pressable
                  onPress={() => setIsEditing(false)}
                  style={[styles.headerDoneBtn, { backgroundColor: tint }]}
                >
                  <Ionicons name="checkmark" size={18} color="#fff" />
                  <ThemedText style={styles.headerDoneBtnText}>Done</ThemedText>
                </Pressable>
              ) : (
                <Pressable
                  onPress={() => activeUserId && router.push(`/member?id=${activeUserId}`)}
                  style={[styles.profileBtn, { borderColor: tint }]}
                  accessibilityLabel="Profile"
                >
                  {activeUser?.photo ? (
                    <Image source={{ uri: activeUser.photo }} style={styles.profileImg} />
                  ) : (
                    <View style={[styles.profilePlaceholder, { backgroundColor: tint }]}>
                      <ThemedText style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>
                        {activeUser?.name?.charAt(0).toUpperCase() || '?'}
                      </ThemedText>
                    </View>
                  )}
                </Pressable>
              )}
            </View>
          ),
        }} 
      />

      {showSearchResults && (
        <View style={[styles.searchContainer, { backgroundColor: bgColor, borderBottomColor: borderColor }]}>
          <View style={[styles.searchBar, { backgroundColor: cardColor, borderColor: borderColor }]}>
            <Ionicons name="search-outline" size={20} color={textColor} style={{ marginLeft: 12 }} />
            <TextInput
              autoFocus
              placeholder="Search family members..."
              placeholderTextColor="#94a3b8"
              value={searchQuery}
              onChangeText={(text) => {
                setSearchQuery(text);
              }}
              style={[styles.searchInput, { color: textColor }]}
            />
            <Pressable onPress={() => { setSearchQuery(''); setShowSearchResults(false); }}>
              <Ionicons name="close-circle" size={20} color="#94a3b8" style={{ marginRight: 12 }} />
            </Pressable>
          </View>
          
          {searchQuery.length > 0 && filteredMembers.length > 0 && (
            <View style={[styles.searchResults, { backgroundColor: cardColor, borderColor: borderColor }]}>
              {filteredMembers.map((m) => (
                <Pressable 
                  key={m.id} 
                  style={[styles.searchResultItem, { borderBottomColor: borderColor }]}
                  onPress={() => {
                    setShowSearchResults(false);
                    setSearchQuery('');
                    router.push(`/member?id=${m.id}`);
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: tint + '20', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
                      {m.photo ? (
                        <Image source={{ uri: m.photo }} style={{ width: '100%', height: '100%' }} />
                      ) : (
                        <ThemedText style={{ color: tint, fontWeight: '800', fontSize: 14 }}>{m.name.charAt(0)}</ThemedText>
                      )}
                    </View>
                    <View>
                      <ThemedText style={{ color: textColor, fontWeight: '700', fontSize: 15 }}>{m.name}</ThemedText>
                      {(m.sex || m.dob) && (
                        <ThemedText style={{ color: '#94a3b8', fontSize: 11, fontWeight: '600' }}>
                          {m.sex}{m.sex && m.dob ? ' • ' : ''}{m.dob}
                        </ThemedText>
                      )}
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
                </Pressable>
              ))}
            </View>
          )}
        </View>
      )}

      {focusMemberId && (
        <View style={styles.focusHeader} pointerEvents="box-none">
          <View style={[styles.focusPill, { backgroundColor: tint }]}>
            <Ionicons name="git-network-outline" size={16} color="#fff" />
            <ThemedText style={styles.focusPillText}>
              {findMemberNested(members, focusMemberId)?.name}&apos;s Family Subtree
            </ThemedText>
            <Pressable 
              onPress={() => { 
                setFocusStack(prev => prev.slice(0, -1)); 
                setTimeout(() => handleResetZoomPan(), 100); 
              }}
              style={styles.focusCloseBtn}
            >
              <ThemedText style={{ color: '#fff', fontWeight: '900', marginRight: 4, fontSize: 8 }}>
                {focusStack.length > 1 ? 'Back' : 'Done'}
              </ThemedText>
              <Ionicons name={focusStack.length > 1 ? "arrow-back-circle" : "close-circle"} size={10} color="#fff" />
            </Pressable>
          </View>
        </View>
      )}

      <View 
        style={{ flex: 1 }} 
        pointerEvents="box-none"
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          if (width > 0 && height > 0) {
            setContainerDims({ width, height });
          }
        }}
      >
        <ZoomPanContainer
          ref={zoomPanContainerRef}
          contentWidth={virtualWidth || contentWidth}
          contentHeight={virtualHeight || contentHeight}
          containerWidth={containerDims.width}
          containerHeight={containerDims.height}
          minZoom={0.05}
          maxZoom={3}
          onZoomChange={setCurrentZoom}
          onTransform={onTransform}
          initialFocusX={
            pinnedMemberId && centeredPositions[pinnedMemberId] 
              ? centeredPositions[pinnedMemberId].x + 70 
              : (visibleMembers[0] && centeredPositions[visibleMembers[0].id] ? centeredPositions[visibleMembers[0].id].x + 70 : undefined)
          }
          initialFocusY={
            pinnedMemberId && centeredPositions[pinnedMemberId] 
              ? centeredPositions[pinnedMemberId].y + 40 
              : (visibleMembers[0] && centeredPositions[visibleMembers[0].id] ? centeredPositions[visibleMembers[0].id].y + 40 : undefined)
          }
        >
          {/* Use fixed screen-sized container - nodes are positioned absolutely */}
          <Pressable 
            style={{ 
              width: virtualWidth, 
              height: virtualHeight, 
              paddingBottom: 96,
              overflow: 'visible'
            }} 
            onPress={() => setExpandedNodeId(null)}
          >
            {/* Spouse Edges - Rendered as individual SVGs to prevent GPU crashes on large trees */}
            {spouseEdges.map((e, i) => {
              const a = centeredPositions[e.from];
              const b = centeredPositions[e.to];
              if (!a || !b) return null;
              if (!isEdgeVisible(e.from, e.to)) return null;
              
              const x1 = a.x + Layout.nodeWidth / 2;
              const y1 = a.y + Layout.spouseLineOffset;
              const x2 = b.x + Layout.nodeWidth / 2;
              const y2 = b.y + Layout.spouseLineOffset;

              const minX = Math.min(x1, x2);
              const minY = Math.min(y1, y2);
              const svgW = Math.max(2, Math.abs(x2 - x1));
              const svgH = Math.max(2, Math.abs(y2 - y1));
              
              return (
                <Svg 
                  key={`spouse-${i}`}
                  width={svgW}
                  height={svgH}
                  style={{ position: 'absolute', left: minX, top: minY }}
                  pointerEvents="none"
                >
                  <Line
                    x1={x1 - minX} y1={y1 - minY}
                    x2={x2 - minX} y2={y2 - minY}
                    stroke="#FF2D55"
                    strokeWidth={2}
                    strokeDasharray="5, 5"
                  />
                </Svg>
              );
            })}

            {/* Parent-Child Edges - Rendered as individual SVGs */}
            {edges.map((e, i) => {
              const a = centeredPositions[e.from];
              const b = centeredPositions[e.to];
              if (!a || !b) return null;
              if (!isEdgeVisible(e.from, e.to, e.parent2)) return null;

              let startX = a.x + Layout.nodeWidth / 2;
              let startY = a.y + Layout.nodeHeight;

              if (e.isJoint && e.parent2) {
                const p2 = centeredPositions[e.parent2];
                if (p2) {
                  startX = (a.x + p2.x) / 2 + Layout.nodeWidth / 2;
                  startY = a.y + Layout.spouseLineOffset;
                }
              }

              const endX = b.x + Layout.nodeWidth / 2;
              const endY = b.y;
              
              const minX = Math.min(startX, endX);
              const minY = Math.min(startY, endY);
              const svgW = Math.max(2, Math.abs(endX - startX));
              const svgH = Math.max(2, Math.abs(endY - startY));
              
              const midY = (endY - startY) * 0.5;
              const key = e.isJoint && e.parent2 ? [e.from, e.parent2].sort().join('|') : e.from;
              const stroke = edgeColors.get(key) || tint;
              
              return (
                <Svg 
                  key={`edge-${i}`}
                  width={svgW}
                  height={svgH}
                  style={{ position: 'absolute', left: minX, top: minY }}
                  pointerEvents="none"
                >
                  <Path
                    d={`M ${startX - minX} 0 C ${startX - minX} ${midY} ${endX - minX} ${midY} ${endX - minX} ${endY - minY}`}
                    stroke={stroke}
                    strokeOpacity={0.6}
                    strokeWidth={2}
                    fill="none"
                  />
                </Svg>
              );
            })}

            {/* Tree Nodes */}
            {Object.entries(centeredPositions)
              .filter(([id]) => visibleNodeIds.has(id))
              .map(([id, pos]) => {
              const m = visibleMembers.find((mm) => mm.id === id);
              if (!m) return null;
              
              const colors = ['#FF2D55', '#FF9500', '#FFCC00', '#34C759', '#5AC8FA', '#0A84FF', '#5856D6', '#AF52DE'];
              const hash = id.split('').reduce((s, c) => s + c.charCodeAt(0), 0);
              const color = colors[hash % colors.length];
              
              return (
                <TreeNode 
                  key={id}
                  member={m}
                  position={pos}
                  color={color}
                  isEditing={isEditing}
                  isPinned={pinnedMemberId === id}
                  expanded={expandedNodeId === id}
                  showActions={isEditing || activeMemberId === id || expandedNodeId === id}
                  onPress={(id) => handleSelectMember(id)}
                  onLongPress={(id) => { setExpandedNodeId(id); setActiveMemberId(id); }}
                  onAddRelation={(id, type) => { setExpandedNodeId(null); openRelationModal(id, type as any); }}
                  onRemove={handleDeleteMember}
                />
              );
            })}
          </Pressable>
        </ZoomPanContainer>
      </View>

      {relationModal.open && (
        <Modal transparent animationType="fade" visible={relationModal.open} onRequestClose={closeRelationModal}>
          <View style={styles.overlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={closeRelationModal} />
            <View style={[styles.modalCard, { backgroundColor: cardColor, borderColor: borderColor }]}>
              <ThemedText style={[styles.modalTitle, { color: textColor }]}>
                Add {relationModal.type || ''}
              </ThemedText>
              <ThemedText style={[styles.modalSubtitle, { color: textColor }]}>
                Choose an existing member or create a new one to add as a {(relationModal.type || '').toLowerCase()} to the subtree.
              </ThemedText>

              <View style={[styles.toggleContainer, { borderColor: borderColor }]}
              >
                <Pressable
                  style={[styles.toggle, !useNewTarget && { backgroundColor: tint }]}
                  onPress={() => setUseNewTarget(false)}
                >
                  <ThemedText style={[styles.toggleText, !useNewTarget && { color: '#fff' }]}>
                    Existing
                  </ThemedText>
                </Pressable>
                <Pressable
                  style={[styles.toggle, useNewTarget && { backgroundColor: tint }]}
                  onPress={() => setUseNewTarget(true)}
                >
                  <ThemedText style={[styles.toggleText, useNewTarget && { color: '#fff' }]}>
                    New
                  </ThemedText>
                </Pressable>
              </View>

              {useNewTarget ? (
                <View>
                  <TextInput
                    placeholder="Name"
                    placeholderTextColor="#94a3b8"
                    value={newTargetName}
                    onChangeText={setNewTargetName}
                    style={[styles.input, { backgroundColor: bgColor, borderColor: borderColor, color: textColor }]}
                  />

                  <ThemedText style={[styles.label, { color: textColor }]}>Sex</ThemedText>
                  <View style={styles.sexRow}>
                    {['Male', 'Female', 'Other'].map((opt) => (
                      <Pressable
                        key={opt}
                        style={[
                          styles.sexChip,
                          { borderColor: borderColor },
                          newTargetSex === opt && { backgroundColor: tint, borderColor: tint }
                        ]}
                        onPress={() => setNewTargetSex(opt as any)}
                      >
                        <ThemedText style={[styles.sexChipText, newTargetSex === opt && { color: '#fff' }]}>
                          {opt}
                        </ThemedText>
                      </Pressable>
                    ))}
                  </View>

                  <ThemedText style={[styles.label, { color: textColor }]}>Date of Birth</ThemedText>
                  <View style={[styles.dateInputContainer, { borderColor: borderColor }]}>
                    <TextInput
                      placeholder="MM/DD/YYYY"
                      placeholderTextColor="#94a3b8"
                      value={newTargetDob}
                      onChangeText={(t) => handleDateInputChange(t, setNewTargetDob)}
                      keyboardType="number-pad"
                      style={[styles.dateInput, { color: textColor }]}
                    />
                    <Pressable 
                      onPress={handleOpenDobPicker}
                      style={styles.calendarIcon}
                    >
                      <Ionicons name="calendar-outline" size={20} color={tint} />
                    </Pressable>
                  </View>
                </View>
              ) : (
                <View style={{ flex: 1 }}>
                  <View style={[styles.modalSearchBar, { backgroundColor: bgColor, borderColor: borderColor }]}>
                    <Ionicons name="search-outline" size={18} color="#94a3b8" />
                    <TextInput
                      placeholder="Search existing members..."
                      placeholderTextColor="#94a3b8"
                      value={relationSearchQuery}
                      onChangeText={setRelationSearchQuery}
                      style={[styles.modalSearchInput, { color: textColor }]}
                    />
                    {relationSearchQuery.length > 0 && (
                      <Pressable onPress={() => setRelationSearchQuery('')}>
                        <Ionicons name="close-circle" size={18} color="#94a3b8" />
                      </Pressable>
                    )}
                  </View>
                  
                  <ScrollView style={styles.memberList} showsVerticalScrollIndicator={false}>
                    {(() => {
                      const allMembersMap = new Map<string, Member>();
                      const flatten = (list: Member[]) => {
                        list.forEach(m => {
                          if (!allMembersMap.has(m.id)) {
                            allMembersMap.set(m.id, m);
                          }
                          if (m.subTree) flatten(m.subTree);
                        });
                      };
                      flatten(members);
                      
                      const query = relationSearchQuery.toLowerCase().trim();
                      
                      const filtered = Array.from(allMembersMap.values())
                        .filter((m) => m.id !== relationModal.sourceId)
                        .filter((m) => !query || m.name.toLowerCase().includes(query));

                      if (filtered.length === 0) {
                        return (
                          <View style={{ padding: 20, alignItems: 'center' }}>
                            <ThemedText style={{ color: '#94a3b8', fontSize: 12, fontStyle: 'italic' }}>No members found</ThemedText>
                          </View>
                        );
                      }

                      return filtered.map((m) => (
                        <Pressable
                          key={m.id}
                          onPress={() => setTargetId(m.id)}
                          style={[
                            styles.memberRow,
                            { borderColor: borderColor },
                            targetId === m.id && { backgroundColor: tint + '10', borderColor: tint },
                          ]}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
                            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: tint + '15', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
                              {m.photo ? (
                                <Image source={{ uri: m.photo }} style={{ width: '100%', height: '100%' }} />
                              ) : (
                                <ThemedText style={{ color: tint, fontWeight: '800', fontSize: 16 }}>{m.name.charAt(0)}</ThemedText>
                              )}
                            </View>
                            <View style={{ flex: 1 }}>
                              <ThemedText style={{ color: textColor, fontWeight: '700', fontSize: 14 }}>{m.name}</ThemedText>
                              {(m.sex || m.dob) && (
                                <ThemedText style={{ color: '#94a3b8', fontSize: 11, fontWeight: '500' }}>
                                  {m.sex}{m.sex && m.dob ? ' • ' : ''}{m.dob}
                                </ThemedText>
                              )}
                            </View>
                          </View>
                          <View style={[
                            styles.radioCircle, 
                            { borderColor: borderColor },
                            targetId === m.id && { borderColor: tint, backgroundColor: tint }
                          ]}>
                            {targetId === m.id && <Ionicons name="checkmark" size={14} color="#fff" />}
                          </View>
                        </Pressable>
                      ));
                    })()}
                  </ScrollView>
                </View>
              )}

              <View style={styles.modalButtons}>
                <Pressable onPress={closeRelationModal} style={[styles.modalBtn, { borderColor: borderColor }]}>
                  <ThemedText style={{ color: textColor, fontWeight: '700' }}>Cancel</ThemedText>
                </Pressable>
                <Pressable onPress={saveQuickRelation} style={[styles.modalBtn, { backgroundColor: tint, borderColor: tint }]}>
                  <ThemedText style={{ color: '#fff', fontWeight: '700' }}>Save</ThemedText>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {showDobPicker && (
        <Modal transparent animationType="fade" visible={showDobPicker} onRequestClose={() => setShowDobPicker(false)}>
          <View style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.6)' }]}>
            <View style={[styles.modalCard, { backgroundColor: cardColor, borderColor: borderColor }]}>
              <ThemedText style={[styles.modalTitle, { color: textColor }]}>Select DOB</ThemedText>
              <View style={{ height: 180, overflow: 'hidden' }}>
                <DateTimePicker
                  value={tempDob}
                  mode="date"
                  display="spinner"
                  onChange={onDobChange}
                  maximumDate={new Date()}
                />
              </View>
              <View style={[styles.modalButtons, { marginTop: 12 }]}>
                <Pressable 
                  onPress={() => setShowDobPicker(false)} 
                  style={[styles.modalBtn, { borderColor: borderColor, borderWidth: 1, minWidth: 80 }]}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <ThemedText style={{ color: textColor, fontWeight: '700', textAlign: 'center' }}>Cancel</ThemedText>
                </Pressable>
                <Pressable 
                  onPress={handleConfirmDob} 
                  style={[styles.modalBtn, { backgroundColor: tint, borderColor: tint, borderWidth: 1, minWidth: 80 }]}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <ThemedText style={{ color: '#fff', fontWeight: '700', textAlign: 'center' }}>Confirm</ThemedText>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {exportOpen && (
        <Modal transparent animationType="fade" visible={exportOpen} onRequestClose={closeExport}>
          <View style={styles.overlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={closeExport} />
            <View style={[styles.modalCard, { backgroundColor: cardColor, borderColor: borderColor }]}>
              <ThemedText style={[styles.modalTitle, { color: textColor }]}>Export</ThemedText>
              
              {Platform.OS === 'web' && (
                <Pressable 
                  onPress={() => { closeExport(); void exportToZipWeb(); }}
                  style={[styles.settingsItem, { backgroundColor: bgColor, borderColor: borderColor, marginBottom: 16 }]}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={[styles.settingsIcon, { backgroundColor: '#3b82f615' }]}>
                      <Ionicons name="archive-outline" size={20} color="#3b82f6" />
                    </View>
                    <ThemedText style={{ color: textColor, fontWeight: '600' }}>Download ZIP (with photos)</ThemedText>
                  </View>
                  <Ionicons name="download-outline" size={18} color="#3b82f6" />
                </Pressable>
              )}

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <View style={{ flex: 1, height: 1, backgroundColor: borderColor, opacity: 0.3 }} />
                <ThemedText style={{ fontSize: 12, color: '#94a3b8', fontWeight: '700' }}>TREE JSON</ThemedText>
                <View style={{ flex: 1, height: 1, backgroundColor: borderColor, opacity: 0.3 }} />
              </View>

              <ScrollView style={{ maxHeight: 200, marginBottom: 12 }}>
                <TextInput
                  value={exportText}
                  editable={false}
                  multiline
                  style={[styles.jsonBox, { backgroundColor: bgColor, borderColor: borderColor, color: textColor, minHeight: 100 }]}
                />
              </ScrollView>
              <View style={styles.modalButtons}>
                <Pressable onPress={closeExport} style={[styles.modalBtn, { borderColor: borderColor }]}>
                  <ThemedText style={{ color: textColor, fontWeight: '700' }}>Close</ThemedText>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Toast */}
      {toast && (
        <View style={[styles.toast, { backgroundColor: '#111827' }]}>
          <ThemedText style={{ color: '#fff', fontWeight: '700' }}>{toast}</ThemedText>
        </View>
      )}

      {importOpen && (
        <Modal transparent animationType="fade" visible={importOpen} onRequestClose={closeImport}>
          <View style={styles.overlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={closeImport} />
            <View style={[styles.modalCard, { backgroundColor: cardColor, borderColor: borderColor }]}>
              <ThemedText style={[styles.modalTitle, { color: textColor }]}>Import</ThemedText>
              
              <Pressable 
                onPress={() => { closeImport(); void importFromFile(); }}
                style={[styles.settingsItem, { backgroundColor: bgColor, borderColor: borderColor, marginBottom: 16 }]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={[styles.settingsIcon, { backgroundColor: tint + '15' }]}>
                    <Ionicons name="document-attach-outline" size={20} color={tint} />
                  </View>
                  <ThemedText style={{ color: textColor, fontWeight: '600' }}>Select JSON or ZIP File</ThemedText>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
              </Pressable>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <View style={{ flex: 1, height: 1, backgroundColor: borderColor, opacity: 0.3 }} />
                <ThemedText style={{ fontSize: 12, color: '#94a3b8', fontWeight: '700' }}>OR PASTE SUBTREE JSON</ThemedText>
                <View style={{ flex: 1, height: 1, backgroundColor: borderColor, opacity: 0.3 }} />
              </View>

                  <ScrollView style={{ maxHeight: 200, marginBottom: 12 }}>
                    <TextInput
                      value={importText}
                      onChangeText={setImportText}
                      multiline
                      placeholder="Paste subtree JSON here..."
                      placeholderTextColor="#94a3b8"
                      style={[styles.jsonBox, { backgroundColor: bgColor, borderColor: borderColor, color: textColor, minHeight: 100 }]}
                    />
                  </ScrollView>
              <View style={styles.modalButtons}>
                <Pressable onPress={closeImport} style={[styles.modalBtn, { borderColor: borderColor }]}>
                  <ThemedText style={{ color: textColor, fontWeight: '700' }}>Cancel</ThemedText>
                </Pressable>
                <Pressable onPress={handleImport} style={[styles.modalBtn, { backgroundColor: tint, borderColor: tint }]}>
                  <ThemedText style={{ color: '#fff', fontWeight: '700' }}>Import Tree</ThemedText>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      )}

      <SideTray
        isOpen={leftTrayOpen}
        onClose={() => setLeftTrayOpen(false)}
        side="left"
        title="Menu"
      >
        <ScrollView style={{ padding: 16 }}>
          <View style={{ gap: 24 }}>
            <View>
              <ThemedText style={styles.categoryTitle}>Tree Options</ThemedText>
              <View style={{ gap: 8 }}>
                <Pressable
                  onPress={() => { setShowSearchResults(true); setLeftTrayOpen(false); }}
                  style={[styles.settingsItem, { backgroundColor: cardColor, borderColor: borderColor }]}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={[styles.settingsIcon, { backgroundColor: tint + '15' }]}>
                      <Ionicons name="search-outline" size={20} color={tint} />
                    </View>
                    <ThemedText style={{ color: textColor, fontWeight: '600' }}>Search</ThemedText>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
                </Pressable>

                {!isEditing && (
                  <Pressable
                    onPress={() => { setIsEditing(true); setLeftTrayOpen(false); }}
                    style={[styles.settingsItem, { backgroundColor: cardColor, borderColor: borderColor }]}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <View style={[styles.settingsIcon, { backgroundColor: tint + '15' }]}>
                        <Ionicons name="create-outline" size={20} color={tint} />
                      </View>
                      <ThemedText style={{ color: textColor, fontWeight: '600' }}>Edit</ThemedText>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
                  </Pressable>
                )}

                {focusMemberId && (
                  <Pressable
                    onPress={() => { setFocusStack([]); setLeftTrayOpen(false); setTimeout(() => handleResetZoomPan(), 100); }}
                    style={[styles.settingsItem, { backgroundColor: cardColor, borderColor: borderColor }]}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <View style={[styles.settingsIcon, { backgroundColor: '#FF950015' }]}>
                        <Ionicons name="contract-outline" size={20} color="#FF9500" />
                      </View>
                      <ThemedText style={{ color: textColor, fontWeight: '600' }}>Exit Focus View</ThemedText>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
                  </Pressable>
                )}

                <Pressable
                  onPress={() => { handleExportPress(); setLeftTrayOpen(false); }}
                  style={[styles.settingsItem, { backgroundColor: cardColor, borderColor: borderColor }]}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={[styles.settingsIcon, { backgroundColor: '#3b82f615' }]}>
                      <Ionicons name="share-outline" size={20} color="#3b82f6" />
                    </View>
                    <ThemedText style={{ color: textColor, fontWeight: '600' }}>Export</ThemedText>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
                </Pressable>

                <Pressable
                  onPress={() => { handleImportPress(); setLeftTrayOpen(false); }}
                  style={[styles.settingsItem, { backgroundColor: cardColor, borderColor: borderColor }]}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={[styles.settingsIcon, { backgroundColor: '#10b98115' }]}>
                      <Ionicons name="download-outline" size={20} color="#10b981" />
                    </View>
                    <ThemedText style={{ color: textColor, fontWeight: '600' }}>Import</ThemedText>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
                </Pressable>

                <Pressable
                  onPress={() => { handleReset(); setLeftTrayOpen(false); }}
                  style={[styles.settingsItem, { backgroundColor: cardColor, borderColor: borderColor }]}
                >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <View style={[styles.settingsIcon, { backgroundColor: '#ef444415' }]}>
                        <Ionicons name="refresh-outline" size={20} color="#ef4444" />
                      </View>
                      <ThemedText style={{ color: '#ef4444', fontWeight: '600' }}>Reset</ThemedText>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
                </Pressable>
              </View>
            </View>

          </View>

          <View style={{ marginTop: 40, paddingBottom: 40, alignItems: 'center' }}>
            <ThemedText style={{ fontSize: 12, color: '#94a3b8' }}>Zoom Level: {currentZoom.toFixed(1)}x</ThemedText>
            <Pressable onPress={handleResetZoomPan} style={{ marginTop: 8 }}>
              <ThemedText style={{ color: tint, fontWeight: '700', fontSize: 13 }}>Reset View</ThemedText>
            </Pressable>
          </View>
        </ScrollView>
      </SideTray>

      <SideTray
        isOpen={rightTrayOpen}
        onClose={() => setRightTrayOpen(false)}
        side="right"
        title="Member Details"
      >
        {selectedMember ? (
          <ScrollView style={{ padding: 16 }}>
            <View style={{ alignItems: 'center', marginBottom: 24 }}>
              {selectedMember.photo ? (
                <Image source={{ uri: selectedMember.photo }} style={{ width: 120, height: 120, borderRadius: 60 }} />
              ) : (
                <View style={{ width: 120, height: 120, borderRadius: 60, backgroundColor: tint, justifyContent: 'center', alignItems: 'center' }}>
                  <ThemedText style={{ color: '#fff', fontSize: 48, fontWeight: '800' }}>
                    {selectedMember.name.charAt(0).toUpperCase()}
                  </ThemedText>
                </View>
              )}
              <ThemedText style={{ fontSize: 24, fontWeight: '800', marginTop: 16 }}>{selectedMember.name}</ThemedText>
              {selectedMember.dob && (
                <ThemedText style={{ opacity: 0.6, marginTop: 4 }}>Born: {selectedMember.dob}</ThemedText>
              )}
            </View>

            <View style={{ gap: 20 }}>
              <Pressable 
                onPress={() => { setRightTrayOpen(false); router.push(`/member?id=${selectedMember.id}`); }}
                style={[styles.settingsItem, { backgroundColor: cardColor, borderColor: borderColor }]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={[styles.settingsIcon, { backgroundColor: tint + '15' }]}>
                    <Ionicons name="person-outline" size={20} color={tint} />
                  </View>
                  <ThemedText style={{ color: textColor, fontWeight: '600' }}>View Full Profile</ThemedText>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
              </Pressable>

              <Pressable 
                onPress={() => { 
                  const anchorId = linkedSubtrees[selectedMember.id] || selectedMember.id;
                  setFocusStack(prev => [...prev, anchorId]); 
                  setRightTrayOpen(false);
                  // Reset zoom/pan to focus on the new root
                  setTimeout(() => handleResetZoomPan(), 100);
                }}
                style={[styles.settingsItem, { backgroundColor: cardColor, borderColor: borderColor }]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={[styles.settingsIcon, { backgroundColor: '#5856D615' }]}>
                    <Ionicons name="git-network-outline" size={20} color="#5856D6" />
                  </View>
                  <View>
                    <ThemedText style={{ color: textColor, fontWeight: '600' }}>Focus on Subtree</ThemedText>
                    <ThemedText style={{ color: '#94a3b8', fontSize: 11 }}>View only this person&apos;s branch</ThemedText>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
              </Pressable>

              {linkedSubtrees[selectedMember.id] && (
                <Pressable 
                  onPress={async () => {
                    await FamilyService.removeLink(selectedMember.id);
                    setLinkedSubtrees(prev => {
                      const next = { ...prev };
                      delete next[selectedMember.id!];
                      return next;
                    });
                    setRightTrayOpen(false);
                    enqueueToast('Unlinked from subtree');
                  }}
                  style={[styles.settingsItem, { backgroundColor: cardColor, borderColor: borderColor, marginTop: -12 }]}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={[styles.settingsIcon, { backgroundColor: '#ef444415' }]}>
                      <Ionicons name="unlink-outline" size={20} color="#ef4444" />
                    </View>
                    <ThemedText style={{ color: '#ef4444', fontWeight: '600' }}>Unlink Subtree</ThemedText>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
                </Pressable>
              )}

              <View>
                <ThemedText style={{ fontSize: 16, fontWeight: '700', marginBottom: 12 }}>Family Members</ThemedText>
                {selectedMember.relations && selectedMember.relations.length > 0 ? (
                  <View style={{ gap: 10 }}>
                    {selectedMember.relations.map((rel, idx) => {
                      const target = findMemberNested(members, rel.targetId);
                      if (!target) return null;
                      return (
                        <Pressable 
                          key={idx}
                          onPress={() => { setSelectedMemberId(target.id); }}
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, backgroundColor: cardColor, borderWidth: 1, borderColor: borderColor }}
                        >
                          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: tint + '15', justifyContent: 'center', alignItems: 'center' }}>
                            <ThemedText style={{ fontSize: 16, color: tint, fontWeight: '800' }}>{target.name.charAt(0)}</ThemedText>
                          </View>
                          <View style={{ flex: 1 }}>
                            <ThemedText style={{ fontWeight: '600', color: textColor }}>{target.name}</ThemedText>
                            <ThemedText style={{ fontSize: 12, color: '#94a3b8', textTransform: 'capitalize' }}>{rel.type}</ThemedText>
                          </View>
                          <Ionicons name="chevron-forward" size={16} color="#94a3b8" />
                        </Pressable>
                      );
                    })}
                  </View>
                ) : (
                  <View style={{ padding: 20, alignItems: 'center', backgroundColor: cardColor, borderRadius: 12, borderStyle: 'dashed', borderWidth: 1, borderColor: borderColor }}>
                    <ThemedText style={{ opacity: 0.5, fontStyle: 'italic' }}>No relations added yet.</ThemedText>
                  </View>
                )}
              </View>
            </View>
          </ScrollView>
        ) : (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 }}>
            <Ionicons name="person-outline" size={48} color={borderColor} />
            <ThemedText style={{ marginTop: 16, opacity: 0.5 }}>Select a member to see details</ThemedText>
          </View>
        )}
      </SideTray>

      <FeatureTooltip
        visible={showSubtreeTip}
        title="Discover Family Subtrees"
        message="Look for the branch icon on family members. Tap a member and select 'Focus on Subtree' to view just their family branch — perfect for navigating large trees!"
        onDismiss={async () => {
          setShowSubtreeTip(false);
          await FamilyService.setSeenSubtreeTip();
        }}
        position="center"
      />

    </ThemedView>
  );
}

const styles = StyleSheet.create({
  headerPill: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1.5,
    elevation: 4,
  },
  headerPillText: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 13,
    letterSpacing: -0.2,
  },
  iconBtn: {
    width: 24,
    height: 24,
    borderRadius: 4,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderBottomWidth: 1,
    zIndex: 20,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    paddingHorizontal: 12,
    fontSize: 11,
    fontWeight: '500',
  },
  modalSearchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 40,
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  modalSearchInput: {
    flex: 1,
    paddingHorizontal: 10,
    fontSize: 14,
    fontWeight: '500',
  },
  radioCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileBtn: {
    width: 24,
    height: 24,
    borderRadius: 4,
    borderWidth: 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileImg: {
    width: '100%',
    height: '100%',
  },
  profilePlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerDoneBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  headerDoneBtnText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 12,
  },
  doneBtn: {
    position: 'absolute',
    bottom: 12,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 32,
    zIndex: 2000,
    elevation: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
    ...Platform.select({
      web: { boxShadow: '0 15px 35px rgba(99, 102, 241, 0.5)' },
      default: { shadowColor: '#6366f1', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.5, shadowRadius: 18 }
    }),
  },
  doneBtnText: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 11,
    letterSpacing: -0.3,
  },
  settingsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 6,
    borderRadius: 16,
    borderWidth: 1.5,
    marginBottom: 12,
  },
  settingsIcon: {
    width: 24,
    height: 24,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryTitle: {
    fontSize: 8,
    fontWeight: '800',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
    marginLeft: 4,
  },
  searchResults: {
    position: 'absolute',
    top: 72,
    left: 16,
    right: 16,
    borderRadius: 20,
    borderWidth: 1.5,
    zIndex: 100,
    ...Platform.select({
      web: { boxShadow: '0 15px 35px rgba(0,0,0,0.15)' },
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.15, shadowRadius: 15, elevation: 10 }
    }),
  },
  searchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  inlineLeft: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 28,
    borderWidth: 1.5,
    padding: 16,
    ...Platform.select({
      web: { boxShadow: '0 20px 50px rgba(0,0,0,0.2)' },
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 15 }, shadowOpacity: 0.25, shadowRadius: 25 }
    }),
  },
  modalTitle: {
    fontSize: 14,
    fontWeight: '900',
    marginBottom: 4,
    letterSpacing: -0.5,
  },
  modalSubtitle: {
    fontSize: 11,
    opacity: 0.6,
    marginBottom: 10,
    lineHeight: 12,
  },
  toggleContainer: {
    flexDirection: 'row',
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 4,
    marginBottom: 8,
  },
  toggle: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
  },
  toggleText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#64748b',
  },
  input: {
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 16,
  },
  dateInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: 14,
    marginBottom: 16,
    paddingRight: 12,
  },
  dateInput: {
    flex: 1,
    padding: 8,
    fontSize: 14,
  },
  calendarIcon: {
    padding: 4,
  },
  label: {
    fontSize: 9,
    fontWeight: '800',
    color: '#64748b',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  sexRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  sexChip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    borderColor: '#f1f5f9',
  },
  sexChipText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#64748b',
  },
  memberList: {
    maxHeight: 140,
    marginBottom: 12,
  },
  memberRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    ...Platform.select({
      web: { boxShadow: '0 4px 12px rgba(0,0,0,0.05)' },
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 4 }
    }),
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 4,
    marginTop: 8,
  },
  modalBtn: {
    borderWidth: 1.5,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minWidth: 80,
    alignItems: 'center',
  },
  jsonBox: {
    borderWidth: 1.5,
    borderRadius: 16,
    paddingHorizontal: 8,
    paddingVertical: 8,
    fontSize: 10,
    lineHeight: 12,
    minHeight: 120,
    textAlignVertical: 'top',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  toast: { 
    position: 'absolute', 
    left: 24, 
    right: 24, 
    bottom: 40, 
    alignItems: 'center', 
    paddingVertical: 6, 
    paddingHorizontal: 24,
    borderRadius: 20, 
    zIndex: 200, 
    elevation: 10,
    ...Platform.select({
      web: { boxShadow: '0 10px 30px rgba(0,0,0,0.3)' },
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 12 }
    }),
  },
  focusHeader: {
    position: 'absolute',
    top: 12,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 100,
  },
  focusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 30,
    gap: 4,
    elevation: 8,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
    ...Platform.select({
      web: { boxShadow: '0 12px 30px rgba(99, 102, 241, 0.4)' },
      default: { shadowColor: '#6366f1', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.4, shadowRadius: 15 }
    }),
  },
  focusPillText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 10,
    letterSpacing: -0.3,
  },
  focusCloseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.25)',
    paddingHorizontal: 2,
    paddingVertical: 1,
    borderRadius: 16,
    marginLeft: 2,
  },
});
