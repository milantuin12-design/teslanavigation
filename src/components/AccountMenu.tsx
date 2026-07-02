import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { User as UserIcon, LogOut, Shield, BookmarkCheck, LogIn } from "lucide-react";
import type { User } from "@supabase/supabase-js";

export function AccountMenu() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) { setIsAdmin(false); return; }
    supabase.rpc("has_role", { _user_id: user.id, _role: "admin" }).then(({ data }) => setIsAdmin(!!data));
  }, [user]);

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
          <UserIcon className="w-4 h-4 mr-1" /> {user.email?.split("@")[0]}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-slate-800 border-slate-700 text-white">
        <DropdownMenuItem onClick={() => navigate({ to: "/mijn-routes" })}>
          <BookmarkCheck className="w-4 h-4 mr-2" /> Mijn routes
        </DropdownMenuItem>
        {isAdmin && (
          <DropdownMenuItem onClick={() => navigate({ to: "/admin" })}>
            <Shield className="w-4 h-4 mr-2" /> Admin
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator className="bg-slate-700" />
        <DropdownMenuItem onClick={async () => { await supabase.auth.signOut(); navigate({ to: "/" }); }}>
          <LogOut className="w-4 h-4 mr-2" /> Uitloggen
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
