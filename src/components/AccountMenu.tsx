import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { getCurrentUser, signOut } from "@/lib/auth.functions";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { User as UserIcon, LogOut, Shield, BookmarkCheck, LogIn, MessageSquare, Settings } from "lucide-react";
import { AccountSettingsDialog } from "@/components/AccountSettingsDialog";

type AccountUser = { id: string; email: string; display_name: string | null; gender?: string | null; is_admin: boolean };

export function AccountMenu() {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    let active = true;
    void getCurrentUser().then((value) => {
      if (active) setUser(value as AccountUser | null);
    }).catch(() => { if (active) setUser(null); });
    return () => { active = false; };
  }, []);

  if (!user) {
    return (
      <Link to="/auth">
        <Button size="sm" variant="outline" className="bg-slate-800 border-slate-700 hover:bg-slate-700">
          <LogIn className="w-4 h-4 mr-1" /> Inloggen
        </Button>
      </Link>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className="bg-slate-800 border-slate-700 hover:bg-slate-700">
          <UserIcon className="w-4 h-4 mr-1" /> {user.display_name?.trim() || user.email.split("@")[0]}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-slate-800 border-slate-700 text-white">
        <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
          <Settings className="w-4 h-4 mr-2" /> Accountinstellingen
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => window.location.assign("/mijn-routes")}>
          <BookmarkCheck className="w-4 h-4 mr-2" /> Mijn routes
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => window.location.assign("/mijn-meldingen")}>
          <MessageSquare className="w-4 h-4 mr-2" /> Mijn meldingen
        </DropdownMenuItem>
        {user.is_admin && (
          <DropdownMenuItem onClick={() => window.location.assign("/admin")}>
            <Shield className="w-4 h-4 mr-2" /> Admin
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator className="bg-slate-700" />
        <DropdownMenuItem onClick={async () => { await signOut(); window.location.assign("/"); }}>
          <LogOut className="w-4 h-4 mr-2" /> Uitloggen
        </DropdownMenuItem>
      </DropdownMenuContent>
      <AccountSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} onSaved={(displayName, gender) => { setUser((old) => old ? { ...old, display_name: displayName, gender } : old); window.dispatchEvent(new CustomEvent("tn-profile-updated", { detail: { display_name: displayName, gender } })); }} />
    </DropdownMenu>
  );
}
