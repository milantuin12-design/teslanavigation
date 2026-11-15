import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { getCurrentUser, signOut } from "@/lib/auth.functions";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { User as UserIcon, LogOut, Shield, BookmarkCheck, LogIn, MessageSquare } from "lucide-react";

type AccountUser = { id: string; email: string; display_name: string | null; is_admin: boolean };

export function AccountMenu() {
  const [user, setUser] = useState<AccountUser | null>(null);
  const navigate = useNavigate();

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
          <UserIcon className="w-4 h-4 mr-1" /> {user.email.split("@")[0]}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-slate-800 border-slate-700 text-white">
        <DropdownMenuItem onClick={() => navigate({ to: "/mijn-routes" })}>
          <BookmarkCheck className="w-4 h-4 mr-2" /> Mijn routes
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate({ to: "/mijn-meldingen" })}>
          <MessageSquare className="w-4 h-4 mr-2" /> Mijn meldingen
        </DropdownMenuItem>
        {user.is_admin && (
          <DropdownMenuItem onClick={() => navigate({ to: "/admin" })}>
            <Shield className="w-4 h-4 mr-2" /> Admin
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator className="bg-slate-700" />
        <DropdownMenuItem onClick={async () => { await signOut(); setUser(null); navigate({ to: "/" }); }}>
          <LogOut className="w-4 h-4 mr-2" /> Uitloggen
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
