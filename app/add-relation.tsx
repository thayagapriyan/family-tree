import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { useThemeColor } from '@/hooks/useThemeColor';
import { FamilyService } from '@/services/familyService';
import { Member } from '@/types/Family';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

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

export default function AddRelationScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ sourceId?: string; type?: string }>();
  const [members, setMembers] = useState<Member[]>([]);
  const [sourceId, setSourceId] = useState<string | null>(params.sourceId || null);
  const [selectedType, setSelectedType] = useState<string | null>(params.type || null);
  const [customLabel, setCustomLabel] = useState('');
  const [useNewTarget, setUseNewTarget] = useState(false);
  const [newTargetName, setNewTargetName] = useState('');
  const [newTargetDob, setNewTargetDob] = useState('');
  const [targetId, setTargetId] = useState<string | null>(null);
  
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [tempDate, setTempDate] = useState(new Date());

  const inputBg = useThemeColor({}, 'card');
  const border = useThemeColor({}, 'border');
  const tint = useThemeColor({}, 'tint');
  const textColor = useThemeColor({}, 'text');
  const cardBg = useThemeColor({}, 'card');

  useEffect(() => {
    (async () => {
      const list = await FamilyService.getFamily();
      setMembers(list);
      
      const activeId = await AsyncStorage.getItem('activeUserId');
      if (params.sourceId) setSourceId(params.sourceId);
      else if (activeId) setSourceId(activeId);
      else if (list.length > 0) setSourceId(list[0].id);
    })();
  }, [params.sourceId]);

  const handleSave = async () => {
    if (!sourceId) return Alert.alert('Select source member');
    const type = selectedType === 'other' ? customLabel || 'other' : selectedType;
    if (!type) return Alert.alert('Select relation type');

    const list = [...members];
    
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

    let finalTargetId = targetId;
    if (useNewTarget) {
      if (!newTargetName.trim()) return Alert.alert('Name required');
      finalTargetId = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      list.push({ 
        id: finalTargetId, 
        name: newTargetName.trim(), 
        dob: newTargetDob || undefined,
        relations: [] 
      });
    }

    if (!finalTargetId) return Alert.alert('Select target member');
    if (finalTargetId === sourceId) return Alert.alert('Invalid', 'Cannot relate to self');

    // Add primary relation
    addRelationPair(sourceId, finalTargetId, type);

    // Joint parenting logic
    if (type === 'child') {
      const sourceMember = list.find(m => m.id === sourceId);
      const spouseRel = sourceMember?.relations?.find((r) => r.type === 'spouse' || r.type === 'partner');
      if (spouseRel) {
        addRelationPair(spouseRel.targetId, finalTargetId, 'child');
      }
    } else if (type === 'parent') {
      const parentMember = list.find(m => m.id === finalTargetId);
      const spouseRel = parentMember?.relations?.find((r) => r.type === 'spouse' || r.type === 'partner');
      if (spouseRel) {
        addRelationPair(sourceId, spouseRel.targetId, 'parent');
      }
    } else if (type === 'spouse' || type === 'partner') {
      const sourceMember = list.find(m => m.id === sourceId);
      const childrenRels = sourceMember?.relations?.filter((r) => r.type === 'child') || [];
      childrenRels.forEach((c) => {
        addRelationPair(finalTargetId!, c.targetId, 'child');
      });
    }

    await FamilyService.saveFamily(list);
    setMembers(list);
    router.replace('/tree');
  };

  const onDateChange = (event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
      if (selectedDate) {
        setNewTargetDob(selectedDate.toISOString().split('T')[0]);
      }
    } else {
      if (selectedDate) setTempDate(selectedDate);
    }
  };

  const confirmDate = () => {
    setNewTargetDob(tempDate.toISOString().split('T')[0]);
    setShowDatePicker(false);
  };

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'Add Relation', headerTitleStyle: { fontWeight: '800' } }} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        
        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>1. Who is the source?</ThemedText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.horizontalList}>
            {members.map((item) => (
              <Pressable 
                key={item.id} 
                style={[styles.memberCard, sourceId === item.id && { borderColor: tint, backgroundColor: tint + '10' }, { backgroundColor: inputBg, borderColor: border }]} 
                onPress={() => setSourceId(item.id)}
              >
                <View style={[styles.avatarSmall, { backgroundColor: tint + '20' }]}>
                  {item.photo ? <Image source={{ uri: item.photo }} style={styles.avatarImg} /> : <ThemedText style={{ color: tint, fontWeight: '700' }}>{item.name.charAt(0)}</ThemedText>}
                </View>
                <ThemedText style={styles.memberName} numberOfLines={1}>{item.name}</ThemedText>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>2. What is the relationship?</ThemedText>
          <View style={styles.chipContainer}>
            {RELATION_TYPES.map((item) => (
              <Pressable 
                key={item} 
                style={[styles.chip, selectedType === item && { backgroundColor: tint, borderColor: tint }, { borderColor: border }]} 
                onPress={() => setSelectedType(item)}
              >
                <ThemedText style={[styles.chipText, selectedType === item && { color: '#fff' }]}>{item}</ThemedText>
              </Pressable>
            ))}
          </View>
          {selectedType === 'other' && (
            <TextInput 
              placeholder="Custom label" 
              placeholderTextColor="#94a3b8" 
              style={[styles.input, { backgroundColor: inputBg, borderColor: border, color: textColor }]} 
              value={customLabel} 
              onChangeText={setCustomLabel} 
            />
          )}
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>3. Who is the relative?</ThemedText>
          <View style={styles.toggleContainer}>
            <Pressable style={[styles.toggle, !useNewTarget && { backgroundColor: tint }]} onPress={() => setUseNewTarget(false)}>
              <ThemedText style={[styles.toggleText, !useNewTarget && { color: '#fff' }]}>Existing</ThemedText>
            </Pressable>
            <Pressable style={[styles.toggle, useNewTarget && { backgroundColor: tint }]} onPress={() => setUseNewTarget(true)}>
              <ThemedText style={[styles.toggleText, useNewTarget && { color: '#fff' }]}>New Member</ThemedText>
            </Pressable>
          </View>

          {useNewTarget ? (
            <View style={{ gap: 12 }}>
              <TextInput 
                placeholder="Relative's full name" 
                placeholderTextColor="#94a3b8" 
                style={[styles.input, { backgroundColor: inputBg, borderColor: border, color: textColor }]} 
                value={newTargetName} 
                onChangeText={setNewTargetName} 
              />
              <Pressable 
                style={[styles.input, { backgroundColor: inputBg, borderColor: border, flexDirection: 'row', alignItems: 'center' }]} 
                onPress={() => setShowDatePicker(true)}
              >
                <Ionicons name="calendar-outline" size={20} color={textColor} style={{ marginRight: 10 }} />
                <ThemedText style={{ color: newTargetDob ? textColor : '#94a3b8' }}>
                  {newTargetDob || 'Date of Birth (Optional)'}
                </ThemedText>
              </Pressable>
            </View>
          ) : (
            <View style={styles.targetList}>
              {members.filter(m => m.id !== sourceId).map((item) => (
                <Pressable 
                  key={item.id} 
                  style={[styles.targetRow, targetId === item.id && { backgroundColor: tint + '10', borderColor: tint }, { borderColor: border }]} 
                  onPress={() => setTargetId(item.id)}
                >
                  <View style={[styles.avatarTiny, { backgroundColor: tint + '20' }]}>
                    {item.photo ? <Image source={{ uri: item.photo }} style={styles.avatarImg} /> : <ThemedText style={{ color: tint, fontSize: 12 }}>{item.name.charAt(0)}</ThemedText>}
                  </View>
                  <ThemedText style={styles.targetName}>{item.name}</ThemedText>
                  {targetId === item.id && <ThemedText style={{ color: tint, fontWeight: '800' }}>✓</ThemedText>}
                </Pressable>
              ))}
            </View>
          )}
        </View>

        <Pressable style={[styles.saveButton, { backgroundColor: tint }]} onPress={handleSave}>
          <ThemedText style={styles.saveButtonText}>Save Relationship</ThemedText>
        </Pressable>
        
        <Pressable style={styles.cancelButton} onPress={() => router.back()}>
          <ThemedText style={{ color: '#64748b', fontWeight: '600' }}>Cancel</ThemedText>
        </Pressable>
        
        <View style={{ height: 40 }} />
      </ScrollView>

      {showDatePicker && Platform.OS === 'ios' && (
        <Modal transparent animationType="fade" visible={showDatePicker}>
          <View style={styles.overlay}>
            <View style={[styles.modalCard, { backgroundColor: cardBg, borderColor: border }]}>
              <ThemedText style={styles.modalTitle}>Select Date</ThemedText>
              <DateTimePicker
                value={tempDate}
                mode="date"
                display="spinner"
                onChange={onDateChange}
                maximumDate={new Date()}
              />
              <View style={styles.modalButtons}>
                <Pressable onPress={() => setShowDatePicker(false)} style={[styles.modalBtn, { borderColor: border }]}>
                  <ThemedText style={{ color: textColor }}>Cancel</ThemedText>
                </Pressable>
                <Pressable onPress={confirmDate} style={[styles.modalBtn, { backgroundColor: tint, borderColor: tint }]}>
                  <ThemedText style={{ color: '#fff', fontWeight: '700' }}>Confirm</ThemedText>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {showDatePicker && Platform.OS === 'android' && (
        <DateTimePicker
          value={tempDate}
          mode="date"
          display="default"
          onChange={onDateChange}
          maximumDate={new Date()}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 20 },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 12, color: '#64748b' },
  horizontalList: { flexDirection: 'row', paddingBottom: 8 },
  memberCard: { 
    width: 100, 
    padding: 12, 
    borderRadius: 16, 
    borderWidth: 2, 
    alignItems: 'center', 
    marginRight: 12,
  },
  avatarSmall: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 8, overflow: 'hidden' },
  avatarImg: { width: '100%', height: '100%' },
  memberName: { fontSize: 12, fontWeight: '600', textAlign: 'center' },
  chipContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  chipText: { fontSize: 13, fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: 12, padding: 16, fontSize: 16, marginTop: 12 },
  toggleContainer: { flexDirection: 'row', backgroundColor: '#f1f5f9', borderRadius: 12, padding: 4, marginBottom: 12 },
  toggle: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  toggleText: { fontSize: 14, fontWeight: '700', color: '#64748b' },
  targetList: { gap: 8 },
  targetRow: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 12, borderWidth: 1 },
  avatarTiny: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginRight: 12, overflow: 'hidden' },
  targetName: { flex: 1, fontSize: 15, fontWeight: '500' },
  saveButton: { borderRadius: 16, padding: 18, alignItems: 'center', marginTop: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 5 },
  saveButtonText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  cancelButton: { padding: 16, alignItems: 'center', marginTop: 8 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  modalCard: { width: '85%', borderRadius: 24, padding: 24, borderWidth: 1 },
  modalTitle: { fontSize: 20, fontWeight: '800', marginBottom: 20, textAlign: 'center' },
  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 20 },
  modalBtn: { flex: 1, padding: 14, borderRadius: 12, alignItems: 'center', borderWidth: 1 },
});
