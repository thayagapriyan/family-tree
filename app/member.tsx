import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { useThemeColor } from '@/hooks/useThemeColor';
import { FamilyService } from '@/services/familyService';
import { Member } from '@/types/Family';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const RELATION_TYPES = [
  'parent',
  'child',
  'spouse',
  'sibling',
  'partner',
  'other',
];

function reciprocal(type: string) {
  switch (type) {
    case 'parent': return 'child';
    case 'child': return 'parent';
    case 'spouse':
    case 'partner':
    case 'sibling':
      return type;
    default: return 'other';
  }
}

export default function MemberScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const [members, setMembers] = useState<Member[]>([]);
  const [member, setMember] = useState<Member | null>(null);
  const [adding, setAdding] = useState(false);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [customLabel, setCustomLabel] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingType, setEditingType] = useState<string | null>(null);
  const [editingCustom, setEditingCustom] = useState('');
  const [addNewMember, setAddNewMember] = useState(false);
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberSex, setNewMemberSex] = useState<'Male' | 'Female' | 'Other'>('Male');
  const [newMemberDob, setNewMemberDob] = useState('');
  const [sexInput, setSexInput] = useState('');
  const [dobInput, setDobInput] = useState('');
  const [dodInput, setDodInput] = useState('');
  const [notesInput, setNotesInput] = useState('');
  const [showDobPicker, setShowDobPicker] = useState(false);
  const [pickerSource, setPickerSource] = useState<'profile' | 'adding' | 'dod'>('profile');
  const [tempDob, setTempDob] = useState<Date | null>(null);
  const [isPinned, setIsPinned] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [activeTab, setActiveTab] = useState<'details' | 'family' | 'insights'>('details');

  const inputBg = useThemeColor({}, 'card');
  const cardBg = useThemeColor({}, 'card');
  const border = useThemeColor({}, 'border');
  const tint = useThemeColor({}, 'tint');
  const textColor = useThemeColor({}, 'text');

  const computeAge = (dob?: string) => {
    if (!dob) return undefined;
    const parsed = new Date(dob);
    if (Number.isNaN(parsed.getTime())) return undefined;
    const now = new Date();
    let age = now.getFullYear() - parsed.getFullYear();
    const m = now.getMonth() - parsed.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < parsed.getDate())) age -= 1;
    return age >= 0 ? age : undefined;
  };

  useEffect(() => {
    (async () => {
      const list = await FamilyService.getFamily();
      setMembers(list);
      const found = list.find((m) => m.id === id);
      setMember(found || null);
      if (found) {
        setEditedName(found.name);
        const pinnedId = await FamilyService.getPinnedMemberId();
        setIsPinned(pinnedId === found.id);
      }
    })();
  }, [id]);

  useEffect(() => {
    if (member) {
      setSexInput(member.sex || '');
      setDobInput(member.dob || '');
      setDodInput(member.dod || '');
      setNotesInput(member.notes || '');
      setTempDob(member.dob ? new Date(member.dob) : null);
    } else {
      setSexInput('');
      setDobInput('');
      setDodInput('');
      setNotesInput('');
      setTempDob(null);
    }
  }, [member]);

  const saveMembers = async (list: Member[]) => {
    await FamilyService.saveFamily(list);
    setMembers(list);
    const found = list.find((m) => m.id === id);
    setMember(found || null);
  };

  const handleTogglePin = async () => {
    if (!member) return;
    const newPinnedState = !isPinned;
    const newPinnedId = newPinnedState ? member.id : null;
    await FamilyService.setPinnedMemberId(newPinnedId);
    if (newPinnedId) {
      await AsyncStorage.setItem('activeUserId', newPinnedId);
    }
    setIsPinned(newPinnedState);
  };

  const handleSaveName = async () => {
    if (!member || !editedName.trim()) return;
    const list = [...members];
    const idx = list.findIndex((m) => m.id === member.id);
    if (idx === -1) return;

    list[idx] = { ...list[idx], name: editedName.trim() };
    await saveMembers(list);
    setIsEditingName(false);
  };

  const handlePickProfilePhoto = async () => {
    if (!member) return;

    try {
      if (Platform.OS !== 'web') {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (perm.status !== 'granted') {
          Alert.alert('Permission needed', 'Please allow photo library access to choose a profile picture.');
          return;
        }
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images',
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });

      if (result.canceled) return;
      let uri = result.assets?.[0]?.uri;
      if (!uri) return;

      // On native, copy the image to a permanent location
      if (Platform.OS !== 'web') {
        try {
          const photosDir = `${(FileSystem as any).documentDirectory}photos/`;
          await FileSystem.makeDirectoryAsync(photosDir, { intermediates: true }).catch(() => {});
          const filename = `${member.id}_${Date.now()}.jpg`;
          const dest = `${photosDir}${filename}`;
          await FileSystem.copyAsync({ from: uri, to: dest });
          uri = dest;
        } catch (err) {
          console.error('Failed to copy photo:', err);
        }
      }

      const list = [...members];
      const idx = list.findIndex((m) => m.id === member.id);
      if (idx >= 0) {
        list[idx] = { ...list[idx], photo: uri };
      }

      await saveMembers(list);
    } catch {
      Alert.alert('Error', 'Could not pick an image.');
    }
  };

  const formatDate = (d: Date) => {
    const m = `${d.getMonth() + 1}`.padStart(2, '0');
    const day = `${d.getDate()}`.padStart(2, '0');
    const y = d.getFullYear();
    return `${m}/${day}/${y}`;
  };

  const handleDateInputChange = (text: string, setter: (val: string) => void) => {
    // Remove non-numeric characters
    let cleaned = text.replace(/\D/g, '');
    
    // Limit to 8 digits (MMDDYYYY)
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

  const handleOpenDatePicker = (source: 'profile' | 'adding' | 'dod' = 'profile') => {
    if (Platform.OS === 'web') return;
    setPickerSource(source);
    let currentVal = '';
    if (source === 'profile') currentVal = dobInput;
    else if (source === 'dod') currentVal = dodInput;
    else currentVal = newMemberDob;
    
    const base = currentVal ? new Date(currentVal) : new Date();
    setTempDob(Number.isNaN(base.getTime()) ? new Date() : base);
    setShowDobPicker(true);
  };

  const handleDobPickerChange = (event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      if (event.type === 'set' && selectedDate) {
        setTempDob(selectedDate);
        const formatted = formatDate(selectedDate);
        if (pickerSource === 'profile') {
          setDobInput(formatted);
        } else if (pickerSource === 'dod') {
          setDodInput(formatted);
        } else {
          setNewMemberDob(formatted);
        }
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
    const formatted = formatDate(tempDob);
    if (pickerSource === 'profile') {
      setDobInput(formatted);
    } else if (pickerSource === 'dod') {
      setDodInput(formatted);
    } else {
      setNewMemberDob(formatted);
    }
    setShowDobPicker(false);
  };

  const handleSaveProfileInfo = async () => {
    if (!member) return;
    const list = [...members];
    const idx = list.findIndex((m) => m.id === member.id);
    if (idx === -1) return Alert.alert('Error', 'Member not found');

    const cleanSex = sexInput.trim();
    const cleanDob = dobInput.trim();
    const cleanDod = dodInput.trim();
    const cleanNotes = notesInput.trim();
    const age = computeAge(cleanDob || undefined);

    list[idx] = {
      ...list[idx],
      sex: cleanSex || undefined,
      dob: cleanDob || undefined,
      dod: cleanDod || undefined,
      notes: cleanNotes || undefined,
      age,
    };

    await saveMembers(list);
    Alert.alert('Saved', 'Profile updated');
  };

  const handleAddRelationTo = async (targetId: string) => {
    if (!member) return;
    const type = selectedType === 'other' ? customLabel || 'other' : selectedType;
    if (!type) return Alert.alert('Select relation type');
    if (targetId === member.id) return Alert.alert('Invalid', 'Cannot relate to self');

    const list = [...members];
    const meIdx = list.findIndex((m) => m.id === member.id);
    const targetIdx = list.findIndex((m) => m.id === targetId);
    if (meIdx === -1 || targetIdx === -1) return Alert.alert('Error', 'Member not found');

    list[meIdx].relations = list[meIdx].relations || [];
    list[targetIdx].relations = list[targetIdx].relations || [];

    const exists = list[meIdx].relations!.find((r) => r.targetId === targetId && r.type === type);
    if (exists) return Alert.alert('Exists', 'This relation already exists');

    list[meIdx].relations!.push({ type, targetId });
    const reciprocalType = reciprocal(type);
    list[targetIdx].relations!.push({ type: reciprocalType, targetId: member.id });

    await saveMembers(list);
    setAdding(false);
    setSelectedType(null);
    setCustomLabel('');
  };

  const handleAddNewMember = async () => {
    if (!member || !newMemberName.trim()) return Alert.alert('Name required');
    const type = selectedType === 'other' ? customLabel || 'other' : selectedType;
    if (!type) return Alert.alert('Select relation type');

    const list = [...members];
    const meIdx = list.findIndex((m) => m.id === member.id);
    if (meIdx === -1) return Alert.alert('Error', 'Member not found');

    const newId = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const newMember: Member = { 
      id: newId, 
      name: newMemberName.trim(), 
      sex: newMemberSex,
      dob: newMemberDob || undefined,
      age: computeAge(newMemberDob) || undefined,
      relations: [] 
    };
    list.push(newMember);

    list[meIdx].relations = list[meIdx].relations || [];
    list[meIdx].relations!.push({ type, targetId: newId });
    const reciprocalType = reciprocal(type);
    newMember.relations!.push({ type: reciprocalType, targetId: member.id });

    await saveMembers(list);
    setAdding(false);
    setSelectedType(null);
    setCustomLabel('');
    setAddNewMember(false);
    setNewMemberName('');
    setNewMemberSex('Male');
    setNewMemberDob('');
  };

  const handleStartEdit = (index: number) => {
    if (!member) return;
    const rel = member.relations?.[index];
    if (!rel) return;
    setEditingIndex(index);
    setEditingType(rel.type || 'other');
    setEditingCustom(rel.type === 'other' ? rel.type : '');
  };

  const handleSaveEdit = async () => {
    if (editingIndex === null || !member) return;
    if (!editingType) return Alert.alert('Select relation type');
    const newType = editingType === 'other' ? (editingCustom || 'other') : editingType;
    const list = [...members];
    const meIdx = list.findIndex((m) => m.id === member.id);
    if (meIdx === -1) return Alert.alert('Error', 'Member not found');

    const rel = list[meIdx].relations?.[editingIndex];
    if (!rel) return Alert.alert('Error', 'Relation not found');
    const targetId = rel.targetId;

    list[meIdx].relations![editingIndex].type = newType;

    const targetIdx = list.findIndex((m) => m.id === targetId);
    if (targetIdx !== -1) {
      list[targetIdx].relations = list[targetIdx].relations || [];
      const recIdx = list[targetIdx].relations!.findIndex((r) => r.targetId === member.id);
      const recType = reciprocal(newType);
      if (recIdx !== -1) {
        list[targetIdx].relations![recIdx].type = recType;
      } else {
        list[targetIdx].relations!.push({ type: recType, targetId: member.id });
      }
    }

    await saveMembers(list);
    setEditingIndex(null);
    setEditingType(null);
    setEditingCustom('');
  };

  const handleRemoveRelation = (index: number) => {
    if (!member) return;

    const performRemove = async () => {
      const list = [...members];
      const meIdx = list.findIndex((m) => m.id === member.id);
      if (meIdx === -1) return;
      const rel = list[meIdx].relations?.[index];
      if (!rel) return;
      const targetId = rel.targetId;
      list[meIdx].relations = list[meIdx].relations!.filter((_, i) => i !== index);
      const targetIdx = list.findIndex((m) => m.id === targetId);
      if (targetIdx !== -1) {
        list[targetIdx].relations = (list[targetIdx].relations || []).filter((r) => r.targetId !== member.id);
      }
      await saveMembers(list);
    };

    if (Platform.OS === 'web') {
      if (confirm('Are you sure you want to remove this relation?')) {
        performRemove();
      }
      return;
    }

    Alert.alert('Remove relation', 'Are you sure you want to remove this relation?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: performRemove,
      },
    ]);
  };

  const derivedRelations = useMemo(() => {
    if (!member) return { siblings: [], grandparents: [], cousins: [], nephews: [], nieces: [] };

    const byId = new Map(members.map((m) => [m.id, m] as const));

    const parentsOf = (id: string) => {
      const m = byId.get(id);
      if (!m) return [] as string[];
      return (m.relations || []).filter((r) => r.type === 'parent').map((r) => r.targetId).filter((pid) => byId.has(pid));
    };

    const childrenOf = (id: string) => {
      const m = byId.get(id);
      if (!m) return [] as string[];
      return (m.relations || []).filter((r) => r.type === 'child').map((r) => r.targetId).filter((cid) => byId.has(cid));
    };

    const siblingIds = (() => {
      const parents = parentsOf(member.id);
      const sibs = new Set<string>();
      parents.forEach((p) => {
        childrenOf(p).forEach((c) => {
          if (c !== member.id) sibs.add(c);
        });
      });
      return Array.from(sibs);
    })();

    const grandparentIds = (() => {
      const gps = new Set<string>();
      parentsOf(member.id).forEach((p) => {
        parentsOf(p).forEach((gp) => gps.add(gp));
      });
      return Array.from(gps);
    })();

    const cousinIds = (() => {
      const cousins = new Set<string>();
      parentsOf(member.id).forEach((p) => {
        // parent siblings
        const pParents = parentsOf(p);
        pParents.forEach((gp) => {
          childrenOf(gp).forEach((uncleAunt) => {
            if (uncleAunt === p) return;
            childrenOf(uncleAunt).forEach((c) => cousins.add(c));
          });
        });
      });
      cousins.delete(member.id);
      siblingIds.forEach((s) => cousins.delete(s));
      return Array.from(cousins);
    })();

    const nieceNephewIds = (() => {
      const nn = new Set<string>();
      siblingIds.forEach((sib) => {
        childrenOf(sib).forEach((c) => nn.add(c));
      });
      return Array.from(nn);
    })();

    return {
      siblings: siblingIds.map((id) => byId.get(id)!).filter(Boolean),
      grandparents: grandparentIds.map((id) => byId.get(id)!).filter(Boolean),
      cousins: cousinIds.map((id) => byId.get(id)!).filter(Boolean),
      nephews: nieceNephewIds.map((id) => byId.get(id)!).filter(Boolean),
      nieces: nieceNephewIds.map((id) => byId.get(id)!).filter(Boolean),
    };
  }, [member, members]);

  const insets = useSafeAreaInsets();
  if (!member) return <ThemedView style={styles.container}><ThemedText>Loading...</ThemedText></ThemedView>;

  const handleBack = () => router.back();

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen
        options={{
          title: member.name,
          headerTitleStyle: { fontWeight: '800' },
          headerLeft: () => (
            <Pressable onPress={handleBack} style={{ marginLeft: 12, padding: 6, borderRadius: 8 }}>
              <Ionicons name="chevron-back" size={22} color={tint} />
            </Pressable>
          ),
        }}
      />
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <ScrollView 
          showsVerticalScrollIndicator={false} 
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
        >
          
          <View style={styles.header}>
            <View style={[styles.headerCover, { backgroundColor: tint + '10' }]} />
            <Pressable onPress={handlePickProfilePhoto} style={[styles.avatarLarge, { backgroundColor: cardBg, borderColor: tint }]}>
              {member.photo ? (
                <Image source={{ uri: member.photo }} style={styles.avatarImg} />
              ) : (
                <ThemedText style={{ color: tint, fontSize: 40, fontWeight: '800' }}>{member.name.charAt(0)}</ThemedText>
              )}
              <View style={[styles.editPhotoBadge, { backgroundColor: tint }]}>
                <Ionicons name="camera" size={14} color="#fff" />
              </View>
            </Pressable>
            
            <View style={{ alignItems: 'center', width: '100%', paddingHorizontal: 20 }}>
              {isEditingName ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <TextInput
                    value={editedName}
                    onChangeText={setEditedName}
                    autoFocus
                    style={[styles.nameInput, { color: textColor, borderBottomColor: tint }]}
                    onSubmitEditing={handleSaveName}
                  />
                  <Pressable onPress={handleSaveName}>
                    <Ionicons name="checkmark-circle" size={24} color={tint} />
                  </Pressable>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <ThemedText style={styles.profileName}>{member.name}</ThemedText>
                  <Pressable onPress={() => setIsEditingName(true)}>
                    <Ionicons name="pencil" size={16} color={textColor} style={{ opacity: 0.5 }} />
                  </Pressable>
                </View>
              )}
            </View>

            <Pressable 
              onPress={handleTogglePin}
              style={[styles.pinToggle, { backgroundColor: isPinned ? tint : tint + '15', borderColor: isPinned ? tint : border }]}
            >
              <Ionicons name={isPinned ? "pin" : "pin-outline"} size={16} color={isPinned ? "#fff" : tint} />
              <ThemedText style={[styles.pinToggleText, { color: isPinned ? "#fff" : tint }]}>
                {isPinned ? 'Pinned as Default' : 'Pin as Default'}
              </ThemedText>
            </Pressable>

            {member.dob && <ThemedText style={styles.profileDob}>Born: {member.dob}</ThemedText>}
          </View>

          <View style={styles.tabBar}>
            {(['details', 'family', 'insights'] as const).map((tab) => (
              <Pressable
                key={tab}
                onPress={() => setActiveTab(tab)}
                style={[styles.tab, { flex: 1 }, activeTab === tab && { borderBottomColor: tint }]}
              >
                <ThemedText style={[styles.tabText, activeTab === tab && { color: tint, fontWeight: '800' }]}>
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </ThemedText>
              </Pressable>
            ))}
          </View>

          {activeTab === 'details' && (
            <View style={[styles.section, styles.infoCard, { backgroundColor: inputBg, borderColor: border }]}>
              <ThemedText style={styles.sectionTitle}>Personal Details</ThemedText>
              <ThemedText style={styles.label}>Sex</ThemedText>
              <View style={styles.sexRow}>
                {['Male', 'Female', 'Other'].map((opt) => (
                  <Pressable
                    key={opt}
                    style={[styles.sexChip, sexInput === opt && { backgroundColor: tint, borderColor: tint }]}
                    onPress={() => setSexInput(opt)}
                  >
                    <ThemedText style={[styles.sexChipText, sexInput === opt && { color: '#fff' }]}>{opt}</ThemedText>
                  </Pressable>
                ))}
              </View>
              <ThemedText style={styles.label}>Date of Birth</ThemedText>
              <View style={[styles.dateInputContainer, { borderColor: border }]}>
                <TextInput
                  placeholder="MM/DD/YYYY"
                  placeholderTextColor="#94a3b8"
                  value={dobInput}
                  onChangeText={(t) => handleDateInputChange(t, setDobInput)}
                  keyboardType="number-pad"
                  style={[styles.dateInput, { color: textColor }]}
                />
                <Pressable 
                  onPress={() => handleOpenDatePicker('profile')}
                  style={styles.calendarIcon}
                >
                  <Ionicons name="calendar-outline" size={20} color={tint} />
                </Pressable>
              </View>

              <ThemedText style={styles.label}>Date of Death (Optional)</ThemedText>
              <View style={[styles.dateInputContainer, { borderColor: border }]}>
                <TextInput
                  placeholder="MM/DD/YYYY"
                  placeholderTextColor="#94a3b8"
                  value={dodInput}
                  onChangeText={(t) => handleDateInputChange(t, setDodInput)}
                  keyboardType="number-pad"
                  style={[styles.dateInput, { color: textColor }]}
                />
                <Pressable 
                  onPress={() => handleOpenDatePicker('dod')}
                  style={styles.calendarIcon}
                >
                  <Ionicons name="calendar-outline" size={20} color={tint} />
                </Pressable>
              </View>

              <ThemedText style={styles.label}>Notes</ThemedText>
              <TextInput
                placeholder="Add notes about this person..."
                placeholderTextColor="#94a3b8"
                value={notesInput}
                onChangeText={setNotesInput}
                multiline
                numberOfLines={4}
                style={[styles.notesInput, { backgroundColor: inputBg, borderColor: border, color: textColor }]}
              />

              <ThemedText style={styles.metaText}>Age: {computeAge(dobInput) ?? '—'}</ThemedText>
              <Pressable style={[styles.saveBtn, { backgroundColor: tint }]} onPress={handleSaveProfileInfo}>
                <ThemedText style={{ color: '#fff', fontWeight: '800' }}>Save Changes</ThemedText>
              </Pressable>
            </View>
          )}

          {activeTab === 'family' && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <ThemedText style={styles.sectionTitle}>Relationships</ThemedText>
                <Pressable style={[styles.addButton, { backgroundColor: tint }]} onPress={() => setAdding(true)}>
                  <ThemedText style={styles.addButtonText}>+ Add</ThemedText>
                </Pressable>
              </View>

              <View style={styles.quickActions}>
                {(['parent', 'child', 'spouse', 'sibling'] as const).map((type) => (
                  <Pressable
                    key={type}
                    onPress={() => { setSelectedType(type); setAdding(true); }}
                    style={[styles.quickActionBtn, { backgroundColor: tint + '10', borderColor: tint + '30' }]}
                  >
                    <Ionicons name="add-circle-outline" size={18} color={tint} />
                    <ThemedText style={[styles.quickActionText, { color: tint }]}>{type}</ThemedText>
                  </Pressable>
                ))}
              </View>

              {member.relations && member.relations.length > 0 ? (
                member.relations.map((rel, idx) => {
                  const target = members.find(m => m.id === rel.targetId);
                  return (
                    <Pressable 
                      key={idx} 
                      onPress={() => router.push(`/member?id=${target?.id}`)}
                      style={[styles.relationCard, { backgroundColor: inputBg, borderColor: border }]}
                    >
                      <View style={[styles.avatarSmall, { backgroundColor: tint + '20' }]}>
                        {target?.photo ? <Image source={{ uri: target.photo }} style={styles.avatarImg} /> : <ThemedText style={{ color: tint, fontWeight: '700' }}>{target?.name.charAt(0) || '?'}</ThemedText>}
                      </View>
                      <View style={styles.relationInfo}>
                        <ThemedText style={styles.relationName}>{target?.name || 'Unknown'}</ThemedText>
                        <ThemedText style={styles.relationType}>{rel.type}</ThemedText>
                      </View>
                      <View style={styles.relationActions}>
                        <Pressable onPress={() => handleStartEdit(idx)} style={styles.actionBtn}>
                          <Ionicons name="pencil" size={18} color={tint} />
                        </Pressable>
                        <Pressable onPress={() => handleRemoveRelation(idx)} style={styles.actionBtn}>
                          <Ionicons name="trash-outline" size={18} color="#ef4444" />
                        </Pressable>
                      </View>
                    </Pressable>
                  );
                })
              ) : (
                <ThemedText style={styles.emptyText}>No relationships added yet.</ThemedText>
              )}
            </View>
          )}

          {activeTab === 'insights' && (
            <View style={styles.section}>
              <ThemedText style={styles.sectionTitle}>Family Insights</ThemedText>
              <View style={styles.insightsGrid}>
                <View style={[styles.insightCard, { backgroundColor: inputBg, borderColor: border }]}>
                  <Ionicons name="people-outline" size={24} color={tint} />
                  <ThemedText style={styles.summaryLabel}>Siblings</ThemedText>
                  <ThemedText style={styles.summaryValue} numberOfLines={2}>
                    {derivedRelations.siblings.map((m) => m.name).join(', ') || 'None'}
                  </ThemedText>
                </View>
                <View style={[styles.insightCard, { backgroundColor: inputBg, borderColor: border }]}>
                  <Ionicons name="business-outline" size={24} color="#3b82f6" />
                  <ThemedText style={styles.summaryLabel}>Grandparents</ThemedText>
                  <ThemedText style={styles.summaryValue} numberOfLines={2}>
                    {derivedRelations.grandparents.map((m) => m.name).join(', ') || 'None'}
                  </ThemedText>
                </View>
                <View style={[styles.insightCard, { backgroundColor: inputBg, borderColor: border }]}>
                  <Ionicons name="heart-outline" size={24} color="#ef4444" />
                  <ThemedText style={styles.summaryLabel}>Cousins</ThemedText>
                  <ThemedText style={styles.summaryValue} numberOfLines={2}>
                    {derivedRelations.cousins.map((m) => m.name).join(', ') || 'None'}
                  </ThemedText>
                </View>
                <View style={[styles.insightCard, { backgroundColor: inputBg, borderColor: border }]}>
                  <Ionicons name="star-outline" size={24} color="#f59e0b" />
                  <ThemedText style={styles.summaryLabel}>Nephew/Niece</ThemedText>
                  <ThemedText style={styles.summaryValue} numberOfLines={2}>
                    {derivedRelations.nephews.map((m) => m.name).join(', ') || 'None'}
                  </ThemedText>
                </View>
              </View>
            </View>
          )}
        </ScrollView>

        {adding && (
          <Modal transparent animationType="fade" visible={adding} onRequestClose={() => setAdding(false)}>
            <View style={styles.modalOverlay}>
              <View style={[styles.modalContent, { backgroundColor: inputBg }]}>
                <ThemedText style={styles.modalTitle}>Add Relationship</ThemedText>
                
                <ThemedText style={styles.label}>Relation Type</ThemedText>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                  {RELATION_TYPES.map(t => (
                    <Pressable key={t} style={[styles.chip, selectedType === t && { backgroundColor: tint, borderColor: tint }, { borderColor: border }]} onPress={() => setSelectedType(t)}>
                      <ThemedText style={[styles.chipText, selectedType === t && { color: '#fff' }]}>{t}</ThemedText>
                    </Pressable>
                  ))}
                </ScrollView>

                <View style={styles.toggleContainer}>
                  <Pressable style={[styles.toggle, !addNewMember && { backgroundColor: tint }]} onPress={() => setAddNewMember(false)}>
                    <ThemedText style={[styles.toggleText, !addNewMember && { color: '#fff' }]}>Existing</ThemedText>
                  </Pressable>
                  <Pressable style={[styles.toggle, addNewMember && { backgroundColor: tint }]} onPress={() => setAddNewMember(true)}>
                    <ThemedText style={[styles.toggleText, addNewMember && { color: '#fff' }]}>New</ThemedText>
                  </Pressable>
                </View>

                {addNewMember ? (
                  <View>
                    <TextInput 
                      placeholder="Name" 
                      placeholderTextColor="#94a3b8" 
                      style={[styles.input, { borderColor: border, color: textColor, backgroundColor: '#fff0' }]} 
                      value={newMemberName} 
                      onChangeText={setNewMemberName} 
                    />
                    
                    <ThemedText style={styles.label}>Sex</ThemedText>
                    <View style={styles.sexRow}>
                      {['Male', 'Female', 'Other'].map((opt) => (
                        <Pressable
                          key={opt}
                          style={[styles.sexChip, newMemberSex === opt && { backgroundColor: tint, borderColor: tint }]}
                          onPress={() => setNewMemberSex(opt as any)}
                        >
                          <ThemedText style={[styles.sexChipText, newMemberSex === opt && { color: '#fff' }]}>{opt}</ThemedText>
                        </Pressable>
                      ))}
                    </View>

                    <ThemedText style={styles.label}>Date of Birth</ThemedText>
                    {Platform.OS === 'web' ? (
                      <TextInput
                        placeholder="YYYY-MM-DD"
                        placeholderTextColor="#94a3b8"
                        value={newMemberDob}
                        onChangeText={setNewMemberDob}
                        style={[styles.input, { borderColor: border, color: textColor, backgroundColor: '#fff0' }]}
                      />
                    ) : (
                      <Pressable onPress={() => handleOpenDatePicker('adding')}>
                        <TextInput
                          placeholder="YYYY-MM-DD"
                          placeholderTextColor="#94a3b8"
                          value={newMemberDob}
                          editable={false}
                          style={[styles.input, { borderColor: border, color: textColor, backgroundColor: '#fff0', pointerEvents: 'none' }]}
                        />
                      </Pressable>
                    )}
                  </View>
                ) : (
                  <ScrollView style={styles.memberList}>
                    {members.filter(m => m.id !== member.id).map(m => (
                      <Pressable key={m.id} style={styles.memberRow} onPress={() => handleAddRelationTo(m.id)}>
                        <ThemedText style={{ color: textColor }}>{m.name}</ThemedText>
                      </Pressable>
                    ))}
                  </ScrollView>
                )}

                <View style={styles.modalButtons}>
                  {addNewMember && <Pressable style={[styles.modalBtn, { backgroundColor: tint }]} onPress={handleAddNewMember}><ThemedText style={{ color: '#fff', fontWeight: '700' }}>Save</ThemedText></Pressable>}
                  <Pressable style={styles.modalBtn} onPress={() => setAdding(false)}><ThemedText style={{ color: textColor, fontWeight: '700' }}>Cancel</ThemedText></Pressable>
                </View>
              </View>

            </View>
          </Modal>
        )}

        {editingIndex !== null && (
          <Modal transparent animationType="fade" visible={editingIndex !== null} onRequestClose={() => setEditingIndex(null)}>
            <View style={styles.modalOverlay}>
              <View style={[styles.modalContent, { backgroundColor: inputBg }]}>
                <ThemedText style={styles.modalTitle}>Edit Relationship</ThemedText>
                <ThemedText style={styles.label}>Relation Type</ThemedText>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                  {RELATION_TYPES.map(t => (
                    <Pressable key={t} style={[styles.chip, editingType === t && { backgroundColor: tint, borderColor: tint }, { borderColor: border }]} onPress={() => setEditingType(t)}>
                      <ThemedText style={[styles.chipText, editingType === t && { color: '#fff' }]}>{t}</ThemedText>
                    </Pressable>
                  ))}
                </ScrollView>
                <View style={styles.modalButtons}>
                  <Pressable style={[styles.modalBtn, { backgroundColor: tint }]} onPress={handleSaveEdit}><ThemedText style={{ color: '#fff', fontWeight: '700' }}>Save</ThemedText></Pressable>
                  <Pressable style={styles.modalBtn} onPress={() => setEditingIndex(null)}><ThemedText style={{ color: textColor, fontWeight: '700' }}>Cancel</ThemedText></Pressable>
                </View>
              </View>
            </View>
          </Modal>
        )}


        {showDobPicker && (
          <Modal transparent animationType="fade" visible={showDobPicker} onRequestClose={() => setShowDobPicker(false)}>
            <View style={[styles.modalOverlay, { backgroundColor: 'rgba(0,0,0,0.6)' }]}>
              <View style={[styles.modalContent, { backgroundColor: inputBg }]}> 
                <ThemedText style={styles.modalTitle}>
                  {pickerSource === 'dod' ? 'Select DOD' : 'Select DOB'}
                </ThemedText>
                <View style={{ height: 200, overflow: 'hidden', width: '100%' }}>
                  <DateTimePicker
                    value={tempDob || new Date()}
                    mode="date"
                    display="spinner"
                    onChange={handleDobPickerChange}
                    maximumDate={new Date()}
                  />
                </View>
                <View style={[styles.modalButtons, { marginTop: 20 }]}> 
                  <Pressable 
                    style={[styles.modalBtn, { borderWidth: 1, borderColor: border, minWidth: 80 }]} 
                    onPress={() => setShowDobPicker(false)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <ThemedText style={{ color: textColor, fontWeight: '700', textAlign: 'center' }}>Cancel</ThemedText>
                  </Pressable>
                  <Pressable 
                    style={[styles.modalBtn, { backgroundColor: tint, minWidth: 80 }]} 
                    onPress={handleConfirmDob}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <ThemedText style={{ color: '#fff', fontWeight: '700', textAlign: 'center' }}>Confirm</ThemedText>
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>
        )}
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
  header: { alignItems: 'center', marginBottom: 24, position: 'relative' },
  headerCover: { position: 'absolute', top: -100, left: -100, right: -100, height: 240, opacity: 0.5 },
  avatarLarge: { 
    width: 120, 
    height: 120, 
    borderRadius: 60, 
    borderWidth: 4, 
    alignItems: 'center', 
    justifyContent: 'center', 
    overflow: 'visible', 
    marginTop: 40, 
    marginBottom: 16, 
    ...Platform.select({
      web: { boxShadow: '0 4px 8px rgba(0,0,0,0.1)' },
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 8 }
    }),
    elevation: 5 
  },
  avatarImg: { width: '100%', height: '100%', borderRadius: 60 },
  editPhotoBadge: { position: 'absolute', bottom: 0, right: 0, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#fff' },
  profileName: { fontSize: 28, fontWeight: '900', letterSpacing: -0.5 },
  nameInput: { fontSize: 24, fontWeight: '800', borderBottomWidth: 2, paddingVertical: 0, minWidth: 150, textAlign: 'center' },
  pinToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, marginTop: 12, marginBottom: 4 },
  pinToggleText: { fontSize: 12, fontWeight: '700' },
  profileDob: { fontSize: 14, color: '#64748b', marginTop: 4 },
  
  tabBar: { flexDirection: 'row', paddingHorizontal: 20, marginBottom: 20, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  tab: { paddingVertical: 12, borderBottomWidth: 3, borderBottomColor: 'transparent', alignItems: 'center' },
  tabText: { fontSize: 15, fontWeight: '600', color: '#94a3b8' },

  section: { paddingHorizontal: 20, marginBottom: 32 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sectionTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  infoCard: { 
    borderWidth: 1, 
    borderRadius: 20, 
    padding: 20, 
    ...Platform.select({
      web: { boxShadow: '0 2px 10px rgba(0,0,0,0.05)' },
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 10 }
    }),
    elevation: 2 
  },
  
  quickActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  quickActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1 },
  quickActionText: { fontSize: 13, fontWeight: '700', textTransform: 'capitalize' },

  addButton: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
  addButtonText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  
  relationCard: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    padding: 14, 
    borderRadius: 18, 
    borderWidth: 1, 
    marginBottom: 12, 
    ...Platform.select({
      web: { boxShadow: '0 2px 5px rgba(0,0,0,0.03)' },
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.03, shadowRadius: 5 }
    }),
    elevation: 1 
  },
  avatarSmall: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginRight: 14 },
  relationInfo: { flex: 1 },
  relationName: { fontSize: 17, fontWeight: '700' },
  relationType: { fontSize: 13, color: '#64748b', textTransform: 'capitalize', marginTop: 2 },
  relationActions: { flexDirection: 'row', gap: 4 },
  actionBtn: { padding: 8, borderRadius: 10 },
  
  insightsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  insightCard: { width: '48%', padding: 16, borderRadius: 20, borderWidth: 1, alignItems: 'flex-start', gap: 8 },
  summaryLabel: { fontSize: 12, fontWeight: '800', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 },
  summaryValue: { fontSize: 14, fontWeight: '600', lineHeight: 20 },

  emptyText: { textAlign: 'center', color: '#94a3b8', marginTop: 20, fontStyle: 'italic' },
  modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, backgroundColor: 'rgba(0,0,0,0.5)' },
  modalContent: { 
    width: '100%', 
    maxWidth: 400, 
    borderRadius: 24, 
    padding: 24, 
    ...Platform.select({
      web: { boxShadow: '0 10px 20px rgba(0,0,0,0.3)' },
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.3, shadowRadius: 20 }
    }),
    elevation: 10 
  },
  modalTitle: { fontSize: 20, fontWeight: '800', marginBottom: 20 },
  label: { fontSize: 14, fontWeight: '600', color: '#64748b', marginBottom: 8 },
  chipScroll: { flexDirection: 'row', marginBottom: 16 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, marginRight: 8 },
  chipText: { fontSize: 12, fontWeight: '600' },
  sexRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  sexChip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  sexChipText: { fontSize: 14, fontWeight: '700', color: '#475569' },
  toggleContainer: { flexDirection: 'row', backgroundColor: '#f1f5f9', borderRadius: 12, padding: 4, marginBottom: 16 },
  toggle: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  toggleText: { fontSize: 12, fontWeight: '700', color: '#64748b' },
  input: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 16 },
  dateInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    marginBottom: 16,
    paddingRight: 12,
  },
  dateInput: {
    flex: 1,
    padding: 12,
    fontSize: 16,
  },
  notesInput: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    minHeight: 100,
    textAlignVertical: 'top',
    marginBottom: 16,
  },
  calendarIcon: {
    padding: 4,
  },
  metaText: { fontSize: 14, color: '#64748b', marginBottom: 12 },
  saveBtn: { alignSelf: 'flex-start', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12 },
  memberList: { maxHeight: 200, marginBottom: 16 },
  memberRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
  modalBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12 },
});
