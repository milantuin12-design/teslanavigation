import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { User as UserIcon, LogOut, Shield, BookmarkCheck, LogIn, MessageSquare } from "lucide-react";
import type { User } from "@supabase/supabase-js";

export function AccountMenu() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // Supabase emits INITIAL_SESSION after the listener is attached. Use this
    // single ordered source of truth so a late getUser() response cannot
    // overwrite a newer SIGNED_IN event with a stale null user.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
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
        <DropdownMenuItem onClick={() => navigate({ to: "/mijn-meldingen" })}>
          <MessageSquare className="w-4 h-4 mr-2" /> Mijn meldingen
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
