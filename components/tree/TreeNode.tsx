import { ThemedText } from '@/components/ThemedText';
import { Layout } from '@/constants/theme';
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
    width: Layout.nodeWidth,
    height: Layout.nodeHeight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nodeCard: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
  },
  miniFab: {
    position: 'absolute',
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#6366f1',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    elevation: 8,
    ...Platform.select({
      web: { boxShadow: '0 6px 12px rgba(0,0,0,0.2)' },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 6,
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
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    top: -10,
    right: -10,
    zIndex: 12,
    elevation: 8,
    ...Platform.select({
      web: { boxShadow: '0 4px 8px rgba(0,0,0,0.25)' },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
      }
    }),
    borderWidth: 2,
    borderColor: '#fff',
  },
  removeFabText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '900',
    lineHeight: 22,
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
    fontSize: 18,
    fontWeight: '900',
    lineHeight: 22,
  },
  avatarContainer: {
    width: 90,
    height: 72,
    borderRadius: 18,
    borderWidth: 3,
    padding: 2,
    backgroundColor: '#fff',
    ...Platform.select({
      web: { boxShadow: '0 8px 20px rgba(0,0,0,0.12)' },
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.12, shadowRadius: 10, elevation: 6 }
    }),
  },
  treeBadge: {
    position: 'absolute',
    top: -8,
    left: -8,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
    ...Platform.select({
      web: { boxShadow: '0px 4px 8px rgba(0,0,0,0.12)' },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.12,
        shadowRadius: 6,
      }
    }),
    elevation: 4,
  },
  nodePhoto: { width: '100%', height: '100%', borderRadius: 14 },
  nodePhotoPlaceholder: { 
    width: '100%', 
    height: '100%', 
    borderRadius: 14, 
    alignItems: 'center', 
    justifyContent: 'center' 
  },
  namePill: { 
    paddingHorizontal: 16, 
    paddingVertical: 8, 
    borderRadius: 24, 
    marginTop: 8,
    ...Platform.select({
      web: { boxShadow: '0 6px 15px rgba(0,0,0,0.15)' },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 6,
      }
    }),
    elevation: 8,
    maxWidth: 140,
  },
  pillText: { color: '#fff', fontWeight: '800', fontSize: 13, textAlign: 'center', letterSpacing: -0.2, width: '100%' },
  pinBadge: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: '#6366f1',
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
    zIndex: 10,
    elevation: 4,
  },
  treeBadge: {
    position: 'absolute',
    top: -8,
    left: -8,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
    zIndex: 10,
    elevation: 4,
    ...Platform.select({
      web: { boxShadow: '0 4px 8px rgba(0,0,0,0.2)' },
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4 }
    }),
  },
  labelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
    elevation: 8,
    ...Platform.select({
      web: { boxShadow: '0 8px 20px rgba(0,0,0,0.2)' },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.25,
        shadowRadius: 10,
      }
    }),
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    minWidth: 120,
  },
  labelBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  labelWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 30,
  },
  tooltip: {
    position: 'absolute',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#111827',
    zIndex: 300,
  },
});

export const TreeNode = memo(TreeNodeInner);

