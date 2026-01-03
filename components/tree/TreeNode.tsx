import { ThemedText } from '@/components/ThemedText';
import { Member } from '@/types/family';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { memo, useEffect, useRef } from 'react';
import { Animated, Easing, Image, Platform, Pressable, StyleSheet, View } from 'react-native';

interface TreeNodeProps {
  member: Member;
  position: { x: number; y: number };
  color: string;
  isEditing?: boolean;
  isPinned?: boolean;
  showActions?: boolean;
  expanded?: boolean;
  onPress: (id: string) => void;
  onLongPress?: (id: string) => void;
  onAddRelation: (id: string, type: string) => void;
  onRemove: (id: string) => void;
}

function TreeNodeInner({ member, position, color, isEditing = false, isPinned = false, showActions = false, expanded = false, onPress, onLongPress, onAddRelation, onRemove }: TreeNodeProps) {
  const anim = useRef(new Animated.Value(expanded ? 1 : 0)).current;
  useEffect(() => {
    if (expanded) {
      Animated.spring(anim, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 6 }).start();
    } else {
      Animated.timing(anim, { toValue: 0, duration: 180, easing: Easing.out(Easing.exp), useNativeDriver: true }).start();
    }
  }, [expanded, anim]);

  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] });
  const avatarScale = anim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] });
  const opacity = anim; 

  const parentTranslateY = anim.interpolate({ inputRange: [0, 1], outputRange: [0, -65] });
  const childTranslateY = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 65] });
  const spouseTranslateX = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 105] });
  const siblingTranslateX = anim.interpolate({ inputRange: [0, 1], outputRange: [0, -105] });

  return (
    <View style={[styles.node, { left: position.x, top: position.y, zIndex: expanded ? 1000 : 1 }]}>
      <Pressable 
        style={styles.nodeCard} 
        onPress={() => onPress(member.id)}
        onLongPress={async () => { try { if (Platform.OS !== 'web') await Haptics.selectionAsync(); } catch {} onLongPress && onLongPress(member.id); }}
        delayLongPress={300}
      >
        <Animated.View style={[styles.avatarContainer, { borderColor: color, transform: [{ scale: avatarScale }], borderWidth: expanded ? 4 : 3, shadowOpacity: expanded ? 0.3 : 0.1 }]}>
          {member.photo ? (
            <Image source={{ uri: member.photo }} style={styles.nodePhoto} />
          ) : (
            <View style={[styles.nodePhotoPlaceholder, { backgroundColor: color + '20' }]}>
              <ThemedText style={{ color: color, fontWeight: '700' }}>{member.name.charAt(0)}</ThemedText>
            </View>
          )}

          {isEditing && (
            <Pressable
              hitSlop={styles.hitSlop}
              style={[styles.removeFabAvatar, { backgroundColor: '#ef4444', borderColor: '#fff' }]}
              onPress={() => onRemove(member.id)}
            >
              <ThemedText style={styles.removeFabText}>-</ThemedText>
            </Pressable>
          )}

          {isPinned && (
            <View style={styles.pinBadge}>
              <Ionicons name="pin" size={10} color="#fff" />
            </View>
          )}

          {member.subTree && member.subTree.length > 0 && (
            <View style={[styles.treeBadge, { backgroundColor: color }]}>
              <Ionicons name="git-branch" size={10} color="#fff" />
            </View>
          )}
        </Animated.View>
        <View style={[styles.namePill, { backgroundColor: expanded ? color : color + 'CC' }]}> 
          <ThemedText style={styles.pillText} numberOfLines={1}>{member.name}</ThemedText>
        </View>
      </Pressable>

      {/* Mini FABs (visible when editing) */}
      {isEditing && !expanded && (
        <>
          <Animated.View style={{ opacity, transform: [{ scale }] }}>
            <Pressable 
              hitSlop={styles.hitSlop}
              android_ripple={{ color: '#00000022' }}
              style={[styles.miniFab, { top: -12, alignSelf: 'center', backgroundColor: '#64748b', borderColor: '#fff' }]}
              onPress={() => onAddRelation(member.id, 'parent')}
            >
              <ThemedText style={styles.miniFabText}>+</ThemedText>
            </Pressable>
          </Animated.View> 

          <Animated.View style={{ opacity, transform: [{ scale }] }}>
            <Pressable 
              hitSlop={styles.hitSlop}
              android_ripple={{ color: '#00000022' }}
              style={[styles.miniFab, { bottom: 18, alignSelf: 'center', backgroundColor: color, borderColor: '#fff' }]}
              onPress={() => onAddRelation(member.id, 'child')}
            >
              <ThemedText style={styles.miniFabText}>+</ThemedText>
            </Pressable>
          </Animated.View> 

          <Animated.View style={{ opacity, transform: [{ scale }] }}>
            <Pressable 
              hitSlop={styles.hitSlop}
              android_ripple={{ color: '#00000022' }}
              style={[styles.miniFab, styles.sideFab, { right: 15, top: 17, backgroundColor: '#64748b' }]}
              onPress={() => onAddRelation(member.id, 'spouse')}
            >
              <ThemedText style={styles.miniFabText}>+</ThemedText>
            </Pressable>
          </Animated.View>
        </>
      )}

      {/* Labeled actions (visible when expanded) */}
      {expanded && (
        <>
          <Animated.View style={[styles.labelWrap, { opacity, transform: [{ scale }, { translateY: parentTranslateY }] }]}>
            <Pressable 
              android_ripple={{ color: '#00000022' }}
              style={[styles.labelBtn, { backgroundColor: '#3b82f6' }]} 
              onPress={async () => {
                try { if (Platform.OS !== 'web') await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
                onAddRelation(member.id, 'parent');
              }}
            >
              <Ionicons name="arrow-up" size={14} color="#fff" style={{ marginRight: 6 }} />
              <ThemedText style={styles.labelBtnText}>Add parent</ThemedText>
            </Pressable>
          </Animated.View>

          <Animated.View style={[{ position: 'absolute', zIndex: 20, opacity, transform: [{ scale }, { translateX: spouseTranslateX }] }]}> 
            <Pressable 
              android_ripple={{ color: '#00000022' }}
              style={[styles.labelBtn, { backgroundColor: '#ec4899' }]} 
              onPress={async () => {
                try { if (Platform.OS !== 'web') await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
                onAddRelation(member.id, 'spouse');
              }}
            >
              <Ionicons name="person-add" size={14} color="#fff" style={{ marginRight: 6 }} />
              <ThemedText style={styles.labelBtnText}>Add spouse</ThemedText>
            </Pressable>
          </Animated.View>

          <Animated.View style={[{ position: 'absolute', zIndex: 20, opacity, transform: [{ scale }, { translateX: siblingTranslateX }] }]}> 
            <Pressable 
              android_ripple={{ color: '#00000022' }}
              style={[styles.labelBtn, { backgroundColor: '#8b5cf6' }]} 
              onPress={async () => {
                try { if (Platform.OS !== 'web') await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
                onAddRelation(member.id, 'sibling');
              }}
            >
              <Ionicons name="people" size={14} color="#fff" style={{ marginRight: 6 }} />
              <ThemedText style={styles.labelBtnText}>Add sibling</ThemedText>
            </Pressable>
          </Animated.View>

          <Animated.View style={[styles.labelWrap, { opacity, transform: [{ scale }, { translateY: childTranslateY }] }]}>
            <Pressable 
              android_ripple={{ color: '#00000022' }}
              style={[styles.labelBtn, { backgroundColor: '#10b981' }]} 
              onPress={async () => {
                try { if (Platform.OS !== 'web') await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
                onAddRelation(member.id, 'child');
              }}
            >
              <Ionicons name="arrow-down" size={14} color="#fff" style={{ marginRight: 6 }} />
              <ThemedText style={styles.labelBtnText}>Add child</ThemedText>
            </Pressable>
          </Animated.View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  node: {
    position: 'absolute',
    width: 140,
    height: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nodeCard: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniFab: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#6366f1',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    elevation: 4,
    ...Platform.select({
      web: { boxShadow: '0px 2px 2px rgba(0,0,0,0.2)' },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 2,
      }
    }),
    borderWidth: 2,
    borderColor: '#fff',
  },
  sideFab: {
    borderWidth: 1,
    ...Platform.select({
      web: { boxShadow: '0px 0px 0px rgba(0,0,0,0.15)' },
      default: { shadowOpacity: 0.15 }
    }),
    elevation: 3,
  },
  removeFab: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    top: -10,
    left: -10,
    zIndex: 12,
    elevation: 5,
    ...Platform.select({
      web: { boxShadow: '0px 1px 2px rgba(0,0,0,0.2)' },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.2,
        shadowRadius: 2,
      }
    }),
    borderWidth: 2,
  },
  removeFabAvatar: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    top: -8,
    right: -8,
    zIndex: 12,
    elevation: 6,
    ...Platform.select({
      web: { boxShadow: '0px 1px 3px rgba(0,0,0,0.25)' },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.25,
        shadowRadius: 3,
      }
    }),
    borderWidth: 2,
    borderColor: '#fff',
  },
  removeFabText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
    lineHeight: 20,
    marginTop: -2,
  },
  hitSlop: {
    top: 8,
    bottom: 8,
    left: 8,
    right: 8,
  },
  miniFabText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    lineHeight: 20,
  },
  avatarContainer: {
    width: 80,
    height: 64,
    borderRadius: 8,
    borderWidth: 3,
    padding: 2,
    backgroundColor: '#fff',
    ...Platform.select({
      web: { boxShadow: '0px 2px 4px rgba(0,0,0,0.1)' },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      }
    }),
    elevation: 3,
  },
  nodePhoto: { width: '100%', height: '100%', borderRadius: 6 },
  nodePhotoPlaceholder: { 
    width: '100%', 
    height: '100%', 
    borderRadius: 6, 
    alignItems: 'center', 
    justifyContent: 'center' 
  },
  namePill: { 
    paddingHorizontal: 12, 
    paddingVertical: 4, 
    borderRadius: 20, 
    marginTop: 4,
    ...Platform.select({
      web: { boxShadow: '0px 2px 2px rgba(0,0,0,0.2)' },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 2,
      }
    }),
    elevation: 4,
    maxWidth: 140,
  },
  pillText: { color: '#fff', fontWeight: '700', fontSize: 12, textAlign: 'center' },
  pinBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#3b82f6',
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#fff',
    zIndex: 10,
  },
  treeBadge: {
    position: 'absolute',
    top: -4,
    left: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#fff',
    zIndex: 10,
  },
  labelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    minWidth: 110,
  },
  labelBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  labelWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  tooltip: {
    position: 'absolute',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#111827',
    zIndex: 300,
  },
});

export const TreeNode = memo(TreeNodeInner);

