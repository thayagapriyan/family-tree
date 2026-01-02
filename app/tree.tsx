import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { TreeNode } from '@/components/tree/TreeNode';
import { ZoomPanContainer } from '@/components/ZoomPanContainer';
import { useThemeColor } from '@/hooks/useThemeColor';
import { FamilyService } from '@/services/familyService';
import { Member } from '@/types/Family';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Line, Path } from 'react-native-svg';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

export default function TreeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [members, setMembers] = useState<Member[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [activeMemberId, setActiveMemberId] = useState<string | null>(null);
  const [expandedNodeId, setExpandedNodeId] = useState<string | null>(null);
  const [activeUserId, setActiveUserId] = useState<string | null>(null);
  const [pinnedMemberId, setPinnedMemberId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);
  const bgColor = useThemeColor({}, 'background');
  const cardColor = useThemeColor({}, 'card');
  const borderColor = useThemeColor({}, 'border');
  const textColor = useThemeColor({}, 'text');
  const tint = useThemeColor({}, 'tint');

  const activeUser = useMemo(() => {
    const id = pinnedMemberId || activeUserId;
    return members.find(m => m.id === id) || members.find(m => m.id === activeUserId);
  }, [members, activeUserId, pinnedMemberId]);

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

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportText, setExportText] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [currentZoom, setCurrentZoom] = useState(1);
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
    if (pinnedId && ensured.some(m => m.id === pinnedId)) {
      setActiveUserId(pinnedId);
      await AsyncStorage.setItem('activeUserId', pinnedId);
    } else {
      const savedActiveId = await AsyncStorage.getItem('activeUserId');
      if (savedActiveId && ensured.some(m => m.id === savedActiveId)) {
        setActiveUserId(savedActiveId);
      } else if (ensured.length > 0) {
        setActiveUserId(ensured[0].id);
        await AsyncStorage.setItem('activeUserId', ensured[0].id);
      }
    }

    setActiveMemberId(null);
    if (ensured.length <= 1) setIsEditing(false);
  }, [ensureDefaultMember]);

  const filteredMembers = useMemo(() => {
    if (!searchQuery.trim()) return [];
    return members.filter(m => 
      m.name.toLowerCase().includes(searchQuery.toLowerCase())
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
      const email = typeof (item as any).email === 'string' ? (item as any).email : undefined;
      const photo = typeof (item as any).photo === 'string' ? (item as any).photo : undefined;

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

      sanitized.push({ id, name: name.trim(), dob, email, photo, relations });
    }

    if (sanitized.length === 0) return [];

    // Drop relations that reference missing members.
    const idSet = new Set(sanitized.map((m) => m.id));
    return sanitized.map((m) => ({
      ...m,
      relations: (m.relations || []).filter((r) => idSet.has(r.targetId)),
    }));
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
  }, [exportToFile, exportToZipWeb, openExportModal]);

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

  const { positions, edges, spouseEdges } = useMemo(() => {
    try {
      return calculateTreeLayout(members, SCREEN_W);
    } catch (err) {
      console.error('Layout calculation failed:', err);
      return { layers: [], positions: {}, edges: [], spouseEdges: [] };
    }
  }, [members]);

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
    const rootMember = members[0];
    const fitZoomW = containerDims.width / contentWidth;
    const fitZoomH = containerDims.height / contentHeight;
    const fitZoom = Math.max(0.05, Math.min(1, fitZoomW, fitZoomH) * 0.9);

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
  }, [members, centeredPositions, containerDims, contentWidth, contentHeight, currentZoom]);

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
    if (activeMemberIdRef.current === id) {
      router.push(`/member?id=${id}`);
      return;
    }
    setActiveMemberId(id);
  }, [router]);

  const closeRelationModal = useCallback(() => {
    setRelationModal({ open: false, sourceId: null, type: null });
    setUseNewTarget(true);
    setNewTargetName('');
    setNewTargetSex('Male');
    setNewTargetDob('');
    setTargetId(null);
    setShowDobPicker(false);
    setExpandedNodeId(null);
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
        setNewTargetDob(`${y}-${m}-${d}`);
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
    const y = tempDob.getFullYear();
    const m = String(tempDob.getMonth() + 1).padStart(2, '0');
    const d = String(tempDob.getDate()).padStart(2, '0');
    setNewTargetDob(`${y}-${m}-${d}`);
    setShowDobPicker(false);
  };

  const saveQuickRelation = useCallback(async () => {
    if (!relationModal.open || !relationModal.sourceId || !relationModal.type) return;

    const sourceId = relationModal.sourceId;
    const type = relationModal.type;
    const list: Member[] = [...members];

    // Haptic on save (mobile)
    try { 
      if (Platform.OS !== 'web') await (await import('expo-haptics')).notificationAsync((await import('expo-haptics')).NotificationFeedbackType.Success);
    } catch {}

    const addRelationPair = (id1: string, id2: string, type1to2: string) => {
      const m1 = list.find(m => m.id === id1);
      const m2 = list.find(m => m.id === id2);
      if (!m1 || !m2) return;
      m1.relations = m1.relations || [];
      m2.relations = m2.relations || [];
      if (!m1.relations.find((r) => r.targetId === id2 && r.type === type1to2)) {
        m1.relations.push({ type: type1to2, targetId: id2 });
      }
      const type2to1 = reciprocal(type1to2);
      if (!m2.relations.find((r) => r.targetId === id1 && r.type === type2to1)) {
        m2.relations.push({ type: type2to1, targetId: id1 });
      }
    };

    let finalTargetId: string | null = targetId;
    if (useNewTarget) {
      if (!newTargetName.trim()) {
        Alert.alert('Name required', 'Enter a name to create the new member.');
        return;
      }
      finalTargetId = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      list.push({ 
        id: finalTargetId, 
        name: newTargetName.trim(), 
        sex: newTargetSex,
        dob: newTargetDob,
        relations: [] 
      });
    }

    if (!finalTargetId) {
      Alert.alert('Select member', 'Pick an existing member or create a new one.');
      return;
    }
    if (finalTargetId === sourceId) {
      Alert.alert('Invalid', 'Cannot relate to self.');
      return;
    }

    addRelationPair(sourceId, finalTargetId, type);

    // Keep behavior consistent with Add Relation screen for joint parenting + spouse child-linking.
    if (type === 'child') {
      const sourceMember = list.find(m => m.id === sourceId);
      const spouseRel = sourceMember?.relations?.find((r) => r.type === 'spouse' || r.type === 'partner');
      if (spouseRel) addRelationPair(spouseRel.targetId, finalTargetId, 'child');
    } else if (type === 'spouse') {
      const sourceMember = list.find(m => m.id === sourceId);
      const childrenRels = sourceMember?.relations?.filter((r) => r.type === 'child') || [];
      childrenRels.forEach((c) => addRelationPair(finalTargetId!, c.targetId, 'child'));
    }

    await FamilyService.saveFamily(list);
    setMembers(list);
    closeRelationModal();

    // show toast (queued)
    enqueueToast('Relation saved');
  }, [closeRelationModal, members, newTargetName, relationModal, targetId, useNewTarget, newTargetSex, newTargetDob, enqueueToast]);

  const handleDeleteMember = useCallback(
    async (id: string) => {
      if (members.length <= 1) {
        Alert.alert('Keep one member', 'You need at least one member in your tree.');
        return;
      }

      const performDelete = async () => {
        const memberToDelete = members.find(m => m.id === id);
        if (memberToDelete?.photo && memberToDelete.photo.startsWith('file://')) {
          try {
            await FileSystem.deleteAsync(memberToDelete.photo, { idempotent: true });
          } catch (err) {
            console.warn('Could not delete photo file:', err);
          }
        }

        const next = members
          .filter((m) => m.id !== id)
          .map((m) => ({
            ...m,
            relations: (m.relations || []).filter((r) => r.targetId !== id),
          }));

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
              onPress={() => setSettingsOpen(true)}
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

      <View 
        style={{ flex: 1 }} 
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
          initialFocusX={
            pinnedMemberId && centeredPositions[pinnedMemberId] 
              ? centeredPositions[pinnedMemberId].x + 70 
              : (members[0] && centeredPositions[members[0].id] ? centeredPositions[members[0].id].x + 70 : undefined)
          }
          initialFocusY={
            pinnedMemberId && centeredPositions[pinnedMemberId] 
              ? centeredPositions[pinnedMemberId].y + 40 
              : (members[0] && centeredPositions[members[0].id] ? centeredPositions[members[0].id].y + 40 : undefined)
          }
        >
          <Pressable style={{ flex: 1, width: contentWidth, height: contentHeight, paddingBottom: 96 }} onPress={() => setExpandedNodeId(null)}>
            <Animated.View 
              pointerEvents={expandedNodeId ? 'auto' : 'none'}
              style={[
                StyleSheet.absoluteFill, 
                { 
                  backgroundColor: 'rgba(0,0,0,0.4)', 
                  zIndex: 500,
                  opacity: backdropAnim 
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
              const m = members.find((mm) => mm.id === id);
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
                  {Platform.OS === 'web' ? (
                    <TextInput
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor="#94a3b8"
                      value={newTargetDob}
                      onChangeText={setNewTargetDob}
                      style={[styles.input, { backgroundColor: bgColor, borderColor: borderColor, color: textColor }]}
                    />
                  ) : (
                    <Pressable onPress={handleOpenDobPicker}>
                      <TextInput
                        placeholder="YYYY-MM-DD"
                        placeholderTextColor="#94a3b8"
                        value={newTargetDob}
                        editable={false}
                        style={[styles.input, { backgroundColor: bgColor, borderColor: borderColor, color: textColor, pointerEvents: 'none' }]}
                      />
                    </Pressable>
                  )}
                </View>
              ) : (
                <ScrollView style={styles.memberList}>
                  {members
                    .filter((m) => m.id !== relationModal.sourceId)
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
                    ))}
                </ScrollView>
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

      {settingsOpen && (
        <Modal transparent animationType="none" visible={settingsOpen} onRequestClose={() => setSettingsOpen(false)}>
          <View style={styles.drawerOverlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setSettingsOpen(false)} />
            <Animated.View style={[styles.drawerContent, { backgroundColor: cardColor, borderColor: borderColor, paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, paddingHorizontal: 4 }}>
                <ThemedText style={[styles.modalTitle, { color: textColor, marginBottom: 0 }]}>Menu</ThemedText>
                <Pressable onPress={() => setSettingsOpen(false)}>
                  <Ionicons name="close" size={24} color={textColor} />
                </Pressable>
              </View>

              <View style={{ gap: 12 }}>
                <Pressable
                  onPress={() => { setShowSearchResults(true); setSettingsOpen(false); }}
                  style={[styles.settingsItem, { backgroundColor: bgColor, borderColor: borderColor }]}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={[styles.settingsIcon, { backgroundColor: tint + '15' }]}>
                      <Ionicons name="search-outline" size={20} color={tint} />
                    </View>
                    <ThemedText style={{ color: textColor, fontWeight: '600' }}>Search Members</ThemedText>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
                </Pressable>

                <View style={{ height: 1, backgroundColor: borderColor, marginVertical: 8, opacity: 0.5 }} />

                {!isEditing && (
                  <Pressable
                    onPress={() => { setIsEditing(true); setSettingsOpen(false); }}
                    style={[styles.settingsItem, { backgroundColor: bgColor, borderColor: borderColor }]}
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

                <Pressable
                  onPress={() => { handleExportPress(); setSettingsOpen(false); }}
                  style={[styles.settingsItem, { backgroundColor: bgColor, borderColor: borderColor }]}
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
                  onPress={() => { handleImportPress(); setSettingsOpen(false); }}
                  style={[styles.settingsItem, { backgroundColor: bgColor, borderColor: borderColor }]}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={[styles.settingsIcon, { backgroundColor: '#10b98115' }]}>
                      <Ionicons name="download-outline" size={20} color="#10b981" />
                    </View>
                    <ThemedText style={{ color: textColor, fontWeight: '600' }}>Import Family Data</ThemedText>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
                </Pressable>

                <View style={{ height: 1, backgroundColor: borderColor, marginVertical: 8, opacity: 0.5 }} />

                <Pressable
                  onPress={() => { handleReset(); setSettingsOpen(false); }}
                  style={[styles.settingsItem, { backgroundColor: bgColor, borderColor: borderColor }]}
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

              <View style={{ marginTop: 'auto', paddingBottom: 20, alignItems: 'center' }}>
                <ThemedText style={{ fontSize: 12, color: '#94a3b8' }}>Zoom Level: {currentZoom.toFixed(1)}x</ThemedText>
                <Pressable onPress={handleResetZoomPan} style={{ marginTop: 8 }}>
                  <ThemedText style={{ color: tint, fontWeight: '700', fontSize: 13 }}>Reset View</ThemedText>
                </Pressable>
              </View>
            </Animated.View>
          </View>
        </Modal>
      )}

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
    zIndex: 100,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
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
  drawerOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2000,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  drawerContent: {
    width: '80%',
    maxWidth: 300,
    height: '100%',
    padding: 20,
    paddingTop: Platform.OS === 'ios' ? Math.max(40, insets.top) : 40,
    borderRightWidth: 1,
    elevation: 16,
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
  },
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
});
