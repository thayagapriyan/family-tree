import { Member } from '@/types/family';
import AsyncStorage from '@react-native-async-storage/async-storage';

const FAMILY_KEY = 'local:family';
const PINNED_MEMBER_KEY = 'local:pinned_member';
const LINKED_SUBTREES_KEY = 'local:linked_subtrees';
const SUBTREE_TIP_SEEN_KEY = 'local:subtree_tip_seen';

export const FamilyService = {
  async getFamily(): Promise<Member[]> {
    const raw = await AsyncStorage.getItem(FAMILY_KEY);
    return raw ? JSON.parse(raw) : [];
  },

  async saveFamily(members: Member[]): Promise<void> {
    await AsyncStorage.setItem(FAMILY_KEY, JSON.stringify(members));
  },

  async resetFamily(): Promise<void> {
    await AsyncStorage.removeItem(FAMILY_KEY);
    await AsyncStorage.removeItem(PINNED_MEMBER_KEY);
    await AsyncStorage.removeItem(LINKED_SUBTREES_KEY);
  },

  async getPinnedMemberId(): Promise<string | null> {
    return await AsyncStorage.getItem(PINNED_MEMBER_KEY);
  },

  async setPinnedMemberId(id: string | null): Promise<void> {
    if (id) {
      await AsyncStorage.setItem(PINNED_MEMBER_KEY, id);
    } else {
      await AsyncStorage.removeItem(PINNED_MEMBER_KEY);
    }
  },

  async getLinkedSubtrees(): Promise<Record<string, string>> {
    const raw = await AsyncStorage.getItem(LINKED_SUBTREES_KEY);
    return raw ? JSON.parse(raw) : {};
  },

  async saveLinkedSubtrees(links: Record<string, string>): Promise<void> {
    await AsyncStorage.setItem(LINKED_SUBTREES_KEY, JSON.stringify(links));
  },

  async setLink(memberId: string, anchorId: string): Promise<void> {
    const links = await this.getLinkedSubtrees();
    links[memberId] = anchorId;
    await this.saveLinkedSubtrees(links);
  },

  async removeLink(memberId: string): Promise<void> {
    const links = await this.getLinkedSubtrees();
    delete links[memberId];
    await this.saveLinkedSubtrees(links);
  },

  async hasSeenSubtreeTip(): Promise<boolean> {
    const seen = await AsyncStorage.getItem(SUBTREE_TIP_SEEN_KEY);
    return seen === 'true';
  },

  async setSeenSubtreeTip(): Promise<void> {
    await AsyncStorage.setItem(SUBTREE_TIP_SEEN_KEY, 'true');
  }
};
