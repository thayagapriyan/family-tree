import { SideTray } from '@/components/SideTray';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { MiniMap } from '@/components/tree/MiniMap';
import { TreeNode } from '@/components/tree/TreeNode';
import { ZoomPanContainer } from '@/components/ZoomPanContainer';
import { useThemeColor } from '@/hooks/useThemeColor';
import { FamilyService } from '@/services/familyService';
import { Member } from '@/types/family';
import { calculateTreeLayout } from '@/utils/treeLayout';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Stack, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import JSZip from 'jszip';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Dimensions, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

export default function TreeScreen() {
  const router = useRouter();
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
  const [focusMemberId, setFocusMemberId] = useState<string | null>(null);
  const [relationSearchQuery, setRelationSearchQuery] = useState('');
  const bgColor = useThemeColor({}, 'background');
  const cardColor = useThemeColor({}, 'card');
  const borderColor = useThemeColor({}, 'border');
  const textColor = useThemeColor({}, 'text');
  const tint = useThemeColor({}, 'tint');

  const findMemberNested = useCallback((list: Member[], id: string): Member | undefined => {
    for (const m of list) {
      if (m.id === id) return m;
      if (m.subTree) {
        const found = findMemberNested(m.subTree, id);
        if (found) return found;
      }
    }
    return undefined;
  }, []);

  const activeUser = useMemo(() => {
    const id = pinnedMemberId || activeUserId;
    if (!id) return undefined;
    return findMemberNested(members, id);
  }, [members, activeUserId, pinnedMemberId, findMemberNested]);

  const selectedMember = useMemo(() => {
    if (!selectedMemberId) return undefined;
    return findMemberNested(members, selectedMemberId);
  }, [members, selectedMemberId, findMemberNested]);

  const visibleMembers = useMemo(() => {
    if (!focusMemberId) {
      // Main tree: show only top-level members
      return members;
    }
    // Spouse tree: show the spouse themselves (from main tree) 
    // PLUS anyone explicitly added to this spouse's nested subTree (recursively)
    const spouse = findMemberNested(members, focusMemberId);
    if (!spouse) return [];
    
    const flattened: Member[] = [spouse];
    const collect = (list: Member[]) => {
      list.forEach(m => {
        flattened.push(m);
        if (m.subTree) collect(m.subTree);
      });
    };
    if (spouse.subTree) collect(spouse.subTree);
    
    // Remove duplicates just in case
    const seen = new Set<string>();
    return flattened.filter(m => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
  }, [members, focusMemberId, findMemberNested]);

  const [relationModal, setRelationModal] = useState<{
    open: boolean;
    sourceId: string | null;
    type: 'child' | 'spouse' | 'sibling' | 'parent' | null;
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
  const [currentTranslateX, setCurrentTranslateX] = useState(0);
  const [currentTranslateY, setCurrentTranslateY] = useState(0);
  const [containerDims, setContainerDims] = useState({ width: SCREEN_W, height: SCREEN_H - 240 });
  const [toast, setToast] = useState<string | null>(null);
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
    setMembers(ensured);
    
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
  }, [ensureDefaultMember, findMemberNested]);

  const filteredMembers = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase();
    
    const allMembers: Member[] = [];
    const flatten = (list: Member[]) => {
      list.forEach(m => {
        allMembers.push(m);
        if (m.subTree) flatten(m.subTree);
      });
    };
    flatten(members);

    return allMembers.filter(m => 
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
          dialogTitle: 'Export Family Tree (ZIP)',
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

  const { centeredPositions, contentWidth, contentHeight } = useMemo(() => {
    const nodeW = 140;
    const nodeH = 100;
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
    
    // Content size should be exactly the layout size plus small padding
    // Cap at 20000 to prevent crash on extreme trees
    const width = Math.min(20000, layoutWidth + pad * 2);
    const height = Math.min(20000, Math.max(800, layoutHeight + pad));
    
    // Offset to center the layout within the contentWidth
    const offsetX = isFinite(minX) ? pad - minX : pad;
    const offsetY = isFinite(minY) ? 60 - minY : 60; // align to top with some padding
    
    const shifted: typeof positions = {};
    Object.entries(positions).forEach(([id, p]) => {
      shifted[id] = { x: p.x + offsetX, y: p.y + offsetY };
    });
    return { centeredPositions: shifted, contentWidth: width, contentHeight: height };
  }, [positions]);

  const handleResetZoomPan = useCallback(() => {
    const rootMember = focusMemberId ? findMemberNested(members, focusMemberId) : visibleMembers[0];
    const fitZoomW = containerDims.width / contentWidth;
    const fitZoomH = containerDims.height / contentHeight;
    const fitZoom = Math.max(0.05, Math.min(1, fitZoomW, fitZoomH) * 0.9);

    // If we have a focusMemberId, always center on them at a comfortable zoom initially
    if (focusMemberId && rootMember && centeredPositions[rootMember.id]) {
      const pos = centeredPositions[rootMember.id];
      zoomPanContainerRef.current?.focusOn?.(pos.x + 70, pos.y + 40, 0.8);
      setCurrentZoom(0.8);
      return;
    }

    // If we are already zoomed out (less than 0.4), focus back on root at 0.8x
    if (currentZoom < 0.4 && rootMember && centeredPositions[rootMember.id]) {
      const pos = centeredPositions[rootMember.id];
      zoomPanContainerRef.current?.focusOn?.(pos.x + 70, pos.y + 40, 0.8);
      setCurrentZoom(0.8);
    } else {
      // Otherwise fit the whole tree
      const centerX = contentWidth / 2;
      const centerY = contentHeight / 2;
      zoomPanContainerRef.current?.focusOn?.(centerX, centerY, fitZoom);
      setCurrentZoom(fitZoom);
    }
  }, [members, visibleMembers, focusMemberId, centeredPositions, containerDims, contentWidth, contentHeight, currentZoom, findMemberNested]);

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

  const reciprocal = (type: string) => {
    switch (type) {
      case 'parent': return 'child';
      case 'child': return 'parent';
      case 'spouse':
      case 'partner':
      case 'sibling': return type;
      default: return 'other';
    }
  };

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
    if (!relationModal.open || !relationModal.sourceId || !relationModal.type) return;

    const sourceId = relationModal.sourceId;
    const type = relationModal.type;
    
    // Helper to perform immutable update in nested structure
    const updateNested = (targetList: Member[], id: string, updater: (m: Member) => Member): Member[] => {
      return targetList.map(m => {
        if (m.id === id) {
          return updater(m);
        }
        if (m.subTree) {
          return { ...m, subTree: updateNested(m.subTree, id, updater) };
        }
        return m;
      });
    };

    // Haptic on save (mobile)
    try { 
      if (Platform.OS !== 'web') await (await import('expo-haptics')).notificationAsync((await import('expo-haptics')).NotificationFeedbackType.Success);
    } catch {}

    const addRelationPair = (currentList: Member[], id1: string, id2: string, type1to2: string): Member[] => {
      let next = updateNested(currentList, id1, (m1) => {
        const relations = [...(m1.relations || [])];
        if (!relations.find((r) => r.targetId === id2 && r.type === type1to2)) {
          relations.push({ type: type1to2, targetId: id2 });
        }
        return { ...m1, relations };
      });

      next = updateNested(next, id2, (m2) => {
        const relations = [...(m2.relations || [])];
        const type2to1 = reciprocal(type1to2);
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
        updatedList = updateNested(members, focusMemberId, (spouse) => ({
          ...spouse,
          subTree: [...(spouse.subTree || []), newMember]
        }));
      } else {
        // Add to main tree
        updatedList = [...members, newMember];
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

    // Keep behavior consistent with Add Relation screen for joint parenting + spouse child-linking.
    const findMember = (targetList: Member[], id: string): Member | undefined => {
      for (const m of targetList) {
        if (m.id === id) return m;
        if (m.subTree) {
          const found = findMember(m.subTree, id);
          if (found) return found;
        }
      }
      return undefined;
    };

    if (type === 'child') {
      const sourceMember = findMember(updatedList, sourceId);
      const spouseRel = sourceMember?.relations?.find((r) => r.type === 'spouse' || r.type === 'partner');
      if (spouseRel) updatedList = addRelationPair(updatedList, spouseRel.targetId, finalTargetId, 'child');
    } else if (type === 'spouse') {
      const sourceMember = findMember(updatedList, sourceId);
      const childrenRels = sourceMember?.relations?.filter((r) => r.type === 'child') || [];
      childrenRels.forEach((c) => {
        updatedList = addRelationPair(updatedList, finalTargetId!, c.targetId, 'child');
      });
    }

    await FamilyService.saveFamily(updatedList);
    setMembers(updatedList);
    closeRelationModal();

    // show toast (queued)
    enqueueToast('Relation saved');
  }, [closeRelationModal, members, newTargetName, relationModal, targetId, useNewTarget, newTargetSex, newTargetDob, enqueueToast, focusMemberId]);

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

  return (
    <ThemedView style={{ flex: 1, backgroundColor: bgColor }}>
      <Stack.Screen 
        options={{ 
          headerShown: true,
          title: 'Family Tree',
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
                  <ThemedText style={{ color: textColor, fontWeight: '600' }}>{m.name}</ThemedText>
                  <Ionicons name="chevron-forward" size={16} color="#94a3b8" />
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
              {findMemberNested(members, focusMemberId)?.name}&apos;s Family Tree
            </ThemedText>
            <Pressable 
              onPress={() => { setFocusMemberId(null); setTimeout(() => handleResetZoomPan(), 100); }}
              style={styles.focusCloseBtn}
            >
              <ThemedText style={{ color: '#fff', fontWeight: '700', marginRight: 4 }}>Done</ThemedText>
              <Ionicons name="close-circle" size={20} color="#fff" />
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
          contentWidth={contentWidth}
          contentHeight={contentHeight}
          containerWidth={containerDims.width}
          containerHeight={containerDims.height}
          minZoom={0.05}
          maxZoom={3}
          onZoomChange={setCurrentZoom}
          onTransform={(x, y, s) => {
            setCurrentTranslateX(x);
            setCurrentTranslateY(y);
            setCurrentZoom(s);
          }}
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
          <Pressable style={{ flex: 1, width: contentWidth, height: contentHeight, paddingBottom: 96 }} onPress={() => setExpandedNodeId(null)}>
            <Animated.View 
              style={[
                StyleSheet.absoluteFill, 
                { 
                  backgroundColor: 'rgba(0,0,0,0.4)', 
                  zIndex: 500,
                  opacity: backdropAnim,
                  pointerEvents: expandedNodeId ? 'auto' : 'none'
                }
              ]} 
            />
            <Svg style={StyleSheet.absoluteFill} width={contentWidth} height={contentHeight}>
              {/* Spouse Edges */}
              {spouseEdges.map((e, i) => {
                const a = centeredPositions[e.from];
                const b = centeredPositions[e.to];
                if (!a || !b) return null;
                return (
                  <Line
                    key={`spouse-${i}`}
                    x1={a.x + 70} y1={a.y + 40}
                    x2={b.x + 70} y2={b.y + 40}
                    stroke="#FF2D55"
                    strokeWidth={2}
                    strokeDasharray="5, 5"
                  />
                );
              })}

              {edges.map((e, i) => {
                const a = centeredPositions[e.from];
                const b = centeredPositions[e.to];
                if (!a || !b) return null;

                let startX = a.x + 70;
                let startY = a.y + 80;

                if (e.isJoint && e.parent2) {
                    const p2 = centeredPositions[e.parent2];
                    if (p2) {
                        startX = (a.x + p2.x) / 2 + 70;
                        startY = a.y + 40; // Start from middle of spouse line
                    }
                }

                const endX = b.x + 70;
                const endY = b.y;
                const midY = (startY + endY) / 2;
                
                const key = e.isJoint && e.parent2 ? [e.from, e.parent2].sort().join('|') : e.from;
                const stroke = edgeColors.get(key) || tint;
                return (
                  <Path
                    key={`edge-${i}`}
                    d={`M ${startX} ${startY} C ${startX} ${midY} ${endX} ${midY} ${endX} ${endY}`}
                    stroke={stroke}
                    strokeOpacity={0.6}
                    strokeWidth={2}
                    fill="none"
                  />
                );
              })}
            </Svg>

            {Object.entries(centeredPositions).map(([id, pos]) => {
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

        <MiniMap
          positions={centeredPositions}
          edges={edges}
          zoom={currentZoom}
          translateX={currentTranslateX}
          translateY={currentTranslateY}
          containerWidth={containerDims.width}
          containerHeight={containerDims.height}
          contentWidth={contentWidth}
          contentHeight={contentHeight}
          tint={tint}
        />

        {isEditing && (
          <Pressable
            onPress={() => setIsEditing(false)}
            style={[styles.doneBtn, { backgroundColor: tint }]}
          >
            <Ionicons name="checkmark" size={20} color="#fff" />
            <ThemedText style={styles.doneBtnText}>Done</ThemedText>
          </Pressable>
        )}
      </View>

      {relationModal.open && (
        <Modal transparent animationType="fade" visible={relationModal.open} onRequestClose={closeRelationModal}>
          <View style={styles.overlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={closeRelationModal} />
            <View style={[styles.modalCard, { backgroundColor: cardColor, borderColor: borderColor }]}>
              <ThemedText style={[styles.modalTitle, { color: textColor }]}>
                Add {relationModal.type}
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
                  <View style={[styles.searchContainer, { marginBottom: 12, marginHorizontal: 0, backgroundColor: bgColor, borderColor: borderColor }]}>
                    <Ionicons name="search" size={18} color="#94a3b8" />
                    <TextInput
                      placeholder="Search existing members..."
                      placeholderTextColor="#94a3b8"
                      value={relationSearchQuery}
                      onChangeText={setRelationSearchQuery}
                      style={[styles.searchInput, { color: textColor }]}
                    />
                    {relationSearchQuery.length > 0 && (
                      <Pressable onPress={() => setRelationSearchQuery('')}>
                        <Ionicons name="close-circle" size={18} color="#94a3b8" />
                      </Pressable>
                    )}
                  </View>
                  
                  <ScrollView style={styles.memberList}>
                    {(() => {
                      const allMembers: Member[] = [];
                      const flatten = (list: Member[]) => {
                        list.forEach(m => {
                          allMembers.push(m);
                          if (m.subTree) flatten(m.subTree);
                        });
                      };
                      flatten(members);
                      
                      const query = relationSearchQuery.toLowerCase().trim();
                      
                      return allMembers
                        .filter((m) => m.id !== relationModal.sourceId)
                        .filter((m) => !query || m.name.toLowerCase().includes(query))
                        .map((m) => (
                          <Pressable
                            key={m.id}
                            onPress={() => setTargetId(m.id)}
                            style={[
                              styles.memberRow,
                              { borderColor: borderColor },
                              targetId === m.id && { backgroundColor: tint + '10', borderColor: tint },
                            ]}
                          >
                            <ThemedText style={{ color: textColor, fontWeight: '600' }}>{m.name}</ThemedText>
                            {targetId === m.id && (
                              <ThemedText style={{ color: tint, fontWeight: '800' }}>✓</ThemedText>
                            )}
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
              <View style={{ height: 200, overflow: 'hidden' }}>
                <DateTimePicker
                  value={tempDob}
                  mode="date"
                  display="spinner"
                  onChange={onDobChange}
                  maximumDate={new Date()}
                />
              </View>
              <View style={[styles.modalButtons, { marginTop: 20 }]}>
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
              <ThemedText style={[styles.modalTitle, { color: textColor }]}>Export Family Data</ThemedText>
              
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
                <ThemedText style={{ fontSize: 12, color: '#94a3b8', fontWeight: '700' }}>JSON DATA</ThemedText>
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
              <ThemedText style={[styles.modalTitle, { color: textColor }]}>Import Family Data</ThemedText>
              
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
                <ThemedText style={{ fontSize: 12, color: '#94a3b8', fontWeight: '700' }}>OR PASTE JSON</ThemedText>
                <View style={{ flex: 1, height: 1, backgroundColor: borderColor, opacity: 0.3 }} />
              </View>

              <ScrollView style={{ maxHeight: 200, marginBottom: 12 }}>
                <TextInput
                  value={importText}
                  onChangeText={setImportText}
                  multiline
                  placeholder="Paste JSON here..."
                  placeholderTextColor="#94a3b8"
                  style={[styles.jsonBox, { backgroundColor: bgColor, borderColor: borderColor, color: textColor, minHeight: 100 }]}
                />
              </ScrollView>
              <View style={styles.modalButtons}>
                <Pressable onPress={closeImport} style={[styles.modalBtn, { borderColor: borderColor }]}>
                  <ThemedText style={{ color: textColor, fontWeight: '700' }}>Cancel</ThemedText>
                </Pressable>
                <Pressable onPress={handleImport} style={[styles.modalBtn, { backgroundColor: tint, borderColor: tint }]}>
                  <ThemedText style={{ color: '#fff', fontWeight: '700' }}>Import JSON</ThemedText>
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
            {/* Navigation Category */}
            <View>
              <ThemedText style={styles.categoryTitle}>Navigation</ThemedText>
              <View style={{ gap: 8 }}>
                <Pressable
                  onPress={() => { setShowSearchResults(true); setLeftTrayOpen(false); }}
                  style={[styles.settingsItem, { backgroundColor: cardColor, borderColor: borderColor }]}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={[styles.settingsIcon, { backgroundColor: tint + '15' }]}>
                      <Ionicons name="search-outline" size={20} color={tint} />
                    </View>
                    <ThemedText style={{ color: textColor, fontWeight: '600' }}>Search Members</ThemedText>
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
                        <Ionicons name="pencil-outline" size={20} color={tint} />
                      </View>
                      <ThemedText style={{ color: textColor, fontWeight: '600' }}>Edit Tree</ThemedText>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
                  </Pressable>
                )}

                {focusMemberId && (
                  <Pressable
                    onPress={() => { setFocusMemberId(null); setLeftTrayOpen(false); setTimeout(() => handleResetZoomPan(), 100); }}
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
              </View>
            </View>

            {/* Data Management Category */}
            <View>
              <ThemedText style={styles.categoryTitle}>Data Management</ThemedText>
              <View style={{ gap: 8 }}>
                <Pressable
                  onPress={() => { handleExportPress(); setLeftTrayOpen(false); }}
                  style={[styles.settingsItem, { backgroundColor: cardColor, borderColor: borderColor }]}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={[styles.settingsIcon, { backgroundColor: '#3b82f615' }]}>
                      <Ionicons name="share-outline" size={20} color="#3b82f6" />
                    </View>
                    <ThemedText style={{ color: textColor, fontWeight: '600' }}>Export Family Data</ThemedText>
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
                    <ThemedText style={{ color: textColor, fontWeight: '600' }}>Import Family Data</ThemedText>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
                </Pressable>
              </View>
            </View>

            {/* Danger Zone Category */}
            <View>
              <ThemedText style={styles.categoryTitle}>Danger Zone</ThemedText>
              <Pressable
                onPress={() => { handleReset(); setLeftTrayOpen(false); }}
                style={[styles.settingsItem, { backgroundColor: cardColor, borderColor: borderColor }]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={[styles.settingsIcon, { backgroundColor: '#ef444415' }]}>
                    <Ionicons name="refresh-outline" size={20} color="#ef4444" />
                  </View>
                  <ThemedText style={{ color: '#ef4444', fontWeight: '600' }}>Reset All Data</ThemedText>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
              </Pressable>
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
                  setFocusMemberId(selectedMember.id); 
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
                  <ThemedText style={{ color: textColor, fontWeight: '600' }}>Open {selectedMember.name.split(' ')[0]}&apos;s Family Tree</ThemedText>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
              </Pressable>

              <View>
                <ThemedText style={{ fontSize: 16, fontWeight: '700', marginBottom: 12 }}>Family Relations</ThemedText>
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

    </ThemedView>
  );
}

const styles = StyleSheet.create({
  headerPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  headerPillText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 12,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchContainer: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    zIndex: 20,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    paddingHorizontal: 10,
    fontSize: 14,
  },
  profileBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
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
  doneBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    zIndex: 2000,
    elevation: 5,
    ...Platform.select({
      web: { boxShadow: '0 2px 4px rgba(0,0,0,0.2)' },
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4 }
    }),
  },
  doneBtnText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 14,
  },
  settingsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  settingsIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
    marginLeft: 4,
  },
  searchResults: {
    position: 'absolute',
    top: 48,
    left: 12,
    right: 12,
    borderRadius: 10,
    borderWidth: 1,
    zIndex: 100,
    ...Platform.select({
      web: { boxShadow: '0px 4px 12px rgba(0,0,0,0.1)' },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.1,
        shadowOffset: { width: 0, height: 4 },
        shadowRadius: 8,
        elevation: 5,
      }
    }),
  },
  searchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
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
    maxWidth: 420,
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 12,
  },
  toggleContainer: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 12,
    padding: 4,
    marginBottom: 12,
  },
  toggle: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  toggleText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#64748b',
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 12,
  },
  dateInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    marginBottom: 12,
    paddingRight: 12,
  },
  dateInput: {
    flex: 1,
    padding: 12,
    fontSize: 16,
  },
  calendarIcon: {
    padding: 4,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
    opacity: 0.7,
  },
  sexRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  sexChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    borderColor: '#e2e8f0',
  },
  sexChipText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#64748b',
  },
  memberList: {
    maxHeight: 220,
    marginBottom: 12,
  },
  memberRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 8,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  modalBtn: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  jsonBox: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 13,
    lineHeight: 18,
    minHeight: 200,
    textAlignVertical: 'top',
  },
  toast: { position: 'absolute', left: 16, right: 16, bottom: 20, alignItems: 'center', paddingVertical: 12, borderRadius: 12, zIndex: 200, elevation: 10 },
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
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 25,
    gap: 10,
    elevation: 5,
    ...Platform.select({
      web: { boxShadow: '0 4px 12px rgba(0,0,0,0.15)' },
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8 }
    }),
  },
  focusPillText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 14,
  },
  focusCloseBtn: {
    marginLeft: 4,
    padding: 2,
    flexDirection: 'row',
    alignItems: 'center',
  },
});
