import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Check, Plus, Copy, Edit2, Trash2, UserCircle2 } from 'lucide-react'
import { useUIStore } from '@/stores/uiStore'
import { useProfileStore, type ProfileItem } from '@/stores/profileStore'
import { RenameModal } from './RenameModal'
import { ConfirmModal } from './ConfirmModal'
import { cn } from '@/lib/utils'

export function ProfileModal() {
  const modal      = useUIStore((s) => s.modal)
  const closeModal = useUIStore((s) => s.closeModal)
  const isOpen = modal?.type === 'profile-manager'

  const {
    profiles, activeProfileId,
    createProfile, renameProfile, deleteProfile, duplicateProfile, switchProfile,
  } = useProfileStore()

  const [createOpen,   setCreateOpen]   = useState(false)
  const [renameTarget, setRenameTarget] = useState<ProfileItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ProfileItem | null>(null)

  return (
    <>
      <Dialog.Root open={isOpen} onOpenChange={(open) => !open && closeModal()}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
          <Dialog.Content
            className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
              w-[420px] max-h-[480px] flex flex-col bg-bg-surface
              rounded-[12px] border border-bg-divider shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-bg-divider flex-shrink-0">
              <Dialog.Title className="text-body font-semibold text-text-primary">
                Profiles
              </Dialog.Title>
              <button onClick={closeModal} className="icon-btn">
                <X size={14} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {profiles.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 gap-2">
                  <UserCircle2 size={20} className="text-text-muted opacity-30" />
                  <p className="text-caption text-text-muted">No profiles yet</p>
                </div>
              ) : (
                profiles.map((p) => (
                  <ProfileRow
                    key={p.id}
                    profile={p}
                    isActive={p.id === activeProfileId}
                    onSwitch={() => switchProfile(p.id)}
                    onRename={() => setRenameTarget(p)}
                    onDuplicate={() => duplicateProfile(p.id)}
                    onDelete={() => setDeleteTarget(p)}
                    canDelete={profiles.length > 1}
                  />
                ))
              )}
            </div>

            <div className="flex items-center gap-1.5 px-3 py-2.5 border-t border-bg-divider flex-shrink-0">
              <button
                onClick={() => setCreateOpen(true)}
                className="flex items-center gap-1.5 px-2.5 h-7 rounded text-caption text-text-secondary
                  hover:text-text-primary hover:bg-state-hover transition-colors"
              >
                <Plus size={12} /> New
              </button>
              <div className="flex-1" />
              <button
                onClick={closeModal}
                className="h-7 px-4 rounded-[6px] text-caption font-medium bg-bg-panel text-text-secondary
                  hover:bg-state-hover hover:text-text-primary transition-colors"
              >
                Close
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <RenameModal
        open={createOpen}
        title="New Profile"
        current=""
        confirmLabel="Create"
        onConfirm={(name) => createProfile(name)}
        onClose={() => setCreateOpen(false)}
      />
      <RenameModal
        open={!!renameTarget}
        title="Rename Profile"
        current={renameTarget?.name ?? ''}
        onConfirm={(name) => renameTarget && renameProfile(renameTarget.id, name)}
        onClose={() => setRenameTarget(null)}
      />
      <ConfirmModal
        open={!!deleteTarget}
        title="Delete Profile"
        message={`Delete "${deleteTarget?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        danger
        onConfirm={() => deleteTarget && deleteProfile(deleteTarget.id)}
        onClose={() => setDeleteTarget(null)}
      />
    </>
  )
}

function ProfileRow({
  profile, isActive, onSwitch, onRename, onDuplicate, onDelete, canDelete,
}: {
  profile: ProfileItem
  isActive: boolean
  onSwitch: () => void
  onRename: () => void
  onDuplicate: () => void
  onDelete: () => void
  canDelete: boolean
}) {
  return (
    <div
      onClick={onSwitch}
      className={cn(
        'flex items-center gap-2 px-4 h-10 cursor-pointer select-none group',
        'border-b border-bg-divider transition-colors',
        isActive ? 'bg-state-active text-text-primary' : 'text-text-secondary hover:bg-state-hover hover:text-text-primary',
      )}
    >
      <span className="w-4 flex-shrink-0">
        {isActive && <Check size={14} className="text-accent-start" />}
      </span>
      <span className="flex-1 text-body truncate">{profile.name}</span>

      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <RowIconButton title="Duplicate" onClick={onDuplicate}><Copy size={12} /></RowIconButton>
        <RowIconButton title="Rename" onClick={onRename}><Edit2 size={12} /></RowIconButton>
        <RowIconButton title="Delete" onClick={onDelete} danger disabled={!canDelete}>
          <Trash2 size={12} />
        </RowIconButton>
      </div>
    </div>
  )
}

function RowIconButton({
  children, title, onClick, danger, disabled,
}: {
  children: React.ReactNode
  title: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      className={cn(
        'w-6 h-6 flex items-center justify-center rounded transition-colors',
        'disabled:opacity-30 disabled:cursor-not-allowed',
        danger
          ? 'text-state-danger hover:bg-state-danger/20'
          : 'text-text-muted hover:bg-state-hover hover:text-text-primary',
      )}
    >
      {children}
    </button>
  )
}
