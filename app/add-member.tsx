import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { useThemeColor } from '@/hooks/useThemeColor';
import { FamilyService } from '@/services/familyService';
import { Member } from '@/types/Family';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Stack, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

export default function AddMemberScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [tempDate, setTempDate] = useState(new Date());
  
  const inputBg = useThemeColor({}, 'card');
  const border = useThemeColor({}, 'border');
  const tint = useThemeColor({}, 'tint');
  const textColor = useThemeColor({}, 'text');
  const cardBg = useThemeColor({}, 'card');

  const handleSave = async () => {
    if (!name.trim()) return Alert.alert('Name required');
    const members = await FamilyService.getFamily();
    const newMember: Member = { 
      id: `${Date.now()}-${Math.floor(Math.random() * 10000)}`, 
      name: name.trim(), 
      dob: dob.trim(), 
      relations: [] 
    };
    members.push(newMember);
    await FamilyService.saveFamily(members);
    router.back();
  };

  const onDateChange = (event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
      if (selectedDate) {
        setDob(selectedDate.toISOString().split('T')[0]);
      }
    } else {
      if (selectedDate) setTempDate(selectedDate);
    }
  };

  const confirmDate = () => {
    setDob(tempDate.toISOString().split('T')[0]);
    setShowDatePicker(false);
  };

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'Add Member', headerTitleStyle: { fontWeight: '800' } }} />
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        
        <View style={styles.header}>
          <View style={[styles.iconCircle, { backgroundColor: tint + '10' }]}>
            <Ionicons name="person-add" size={32} color={tint} />
          </View>
          <ThemedText style={styles.title}>New Family Member</ThemedText>
          <ThemedText style={styles.subtitle}>Add a new person to your family tree</ThemedText>
        </View>

        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <ThemedText style={styles.label}>Full Name</ThemedText>
            <TextInput 
              placeholder="e.g. John Doe" 
              placeholderTextColor="#94a3b8" 
              style={[styles.input, { backgroundColor: inputBg, borderColor: border, color: textColor }]} 
              value={name} 
              onChangeText={setName} 
            />
          </View>

          <View style={styles.inputGroup}>
            <ThemedText style={styles.label}>Date of Birth</ThemedText>
            <Pressable 
              style={[styles.input, { backgroundColor: inputBg, borderColor: border, flexDirection: 'row', alignItems: 'center' }]} 
              onPress={() => setShowDatePicker(true)}
            >
              <Ionicons name="calendar-outline" size={20} color={textColor} style={{ marginRight: 10 }} />
              <ThemedText style={{ color: dob ? textColor : '#94a3b8', fontSize: 16 }}>
                {dob || 'Select Date'}
              </ThemedText>
            </Pressable>
          </View>

          <Pressable style={[styles.saveButton, { backgroundColor: tint }]} onPress={handleSave}>
            <ThemedText style={styles.saveButtonText}>Add Member</ThemedText>
          </Pressable>

          <Pressable style={styles.cancelButton} onPress={() => router.back()}>
            <ThemedText style={{ color: '#64748b', fontWeight: '600' }}>Cancel</ThemedText>
          </Pressable>
        </View>

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
  scrollContent: { padding: 24 },
  header: { alignItems: 'center', marginBottom: 40, marginTop: 20 },
  iconCircle: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  title: { fontSize: 24, fontWeight: '800', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#64748b', textAlign: 'center' },
  form: { gap: 20 },
  inputGroup: { gap: 8 },
  label: { fontSize: 14, fontWeight: '700', color: '#64748b', marginLeft: 4 },
  input: { borderWidth: 1, borderRadius: 16, padding: 16, fontSize: 16 },
  saveButton: { borderRadius: 16, padding: 18, alignItems: 'center', marginTop: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 5 },
  saveButtonText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  cancelButton: { padding: 16, alignItems: 'center' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  modalCard: { width: '85%', borderRadius: 24, padding: 24, borderWidth: 1 },
  modalTitle: { fontSize: 20, fontWeight: '800', marginBottom: 20, textAlign: 'center' },
  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 20 },
  modalBtn: { flex: 1, padding: 14, borderRadius: 12, alignItems: 'center', borderWidth: 1 },
});

