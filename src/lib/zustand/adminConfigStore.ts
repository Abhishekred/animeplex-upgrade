import {create} from 'zustand';
import type {AnimePlexAdminConfig} from '../services/adminConfig';

type AdminConfigState = {
  config: AnimePlexAdminConfig | null;
  setConfig: (config: AnimePlexAdminConfig | null) => void;
};

const useAdminConfigStore = create<AdminConfigState>(set => ({
  config: null,
  setConfig: config => set({config}),
}));

export default useAdminConfigStore;
