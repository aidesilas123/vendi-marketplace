"use client";

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Avatar } from '@/shared/Avatar';
import { IonIcon } from '@ionic/react';
import { 
  searchOutline, 
  micOutline, 
  checkmarkDoneOutline, 
  checkmarkOutline, 
  imageOutline, 
  ellipsisVerticalOutline,
  flagOutline,
  closeOutline,
  playOutline
} from 'ionicons/icons';

type ChatPreview = {
  transaction_ref: string;
  partner: any;
  latestMessage: any;
  unreadCount: number;
};

export default function MessagesList() {
  const router = useRouter();
  const [chats, setChats] = useState<ChatPreview[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  const [activeFilter, setActiveFilter] = useState<'all' | 'unread'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showMenu, setShowMenu] = useState(false);

  useEffect(() => {
    fetchChats();

    // Subscribe to ALL message changes to auto-update unread badges and latest messages instantly
    const inboxChannel = supabase.channel('inbox_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => {
        fetchChats();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(inboxChannel);
    };
  }, []);

  // Close the menu when tapping anywhere else
  useEffect(() => {
    if (!showMenu) return;
    const handler = () => setShowMenu(false);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [showMenu]);

  const fetchChats = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return router.push('/login');
    setCurrentUser(user);

    try {
      // 1. Fetch all messages involving this user
      const { data: msgs, error } = await supabase
        .from('messages')
        .select(`
          *,
          sender:sender_id(id, full_name, avatar_url),
          receiver:receiver_id(id, full_name, avatar_url)
        `)
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (msgs) {
        // 2. Group by transaction_ref to extract the single latest message per conversation
        const chatMap = new Map<string, ChatPreview>();

        msgs.forEach((msg) => {
          if (!chatMap.has(msg.transaction_ref)) {
            const partner = msg.sender_id === user.id ? msg.receiver : msg.sender;
            const unreadCount = msgs.filter(m => m.transaction_ref === msg.transaction_ref && m.receiver_id === user.id && m.status !== 'read').length;

            chatMap.set(msg.transaction_ref, {
              transaction_ref: msg.transaction_ref,
              partner,
              latestMessage: msg,
              unreadCount
            });
          }
        });

        setChats(Array.from(chatMap.values()));
      }
    } catch (err) {
      console.error("Error fetching chats:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const isToday = date.getDate() === now.getDate() && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();

    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return "Yesterday"; 
  };

  const renderMessagePreview = (msg: any) => {
    const isMe = msg.sender_id === currentUser?.id;

    // CORE FIX: Orange double ticks for 'read', grey double for 'delivered', grey single for 'sent'
    const tickIcon = isMe ? (
      <IonIcon 
        icon={(msg.status === 'read' || msg.status === 'delivered') ? checkmarkDoneOutline : checkmarkOutline} 
        className={`text-[15px] mr-1 ${msg.status === 'read' ? '!text-orange-500' : 'text-muted-foreground'}`} 
      />
    ) : null;

    if (msg.is_deleted) {
      return (
        <div className="flex items-center text-muted-foreground text-[14px] italic">
          <IonIcon icon={closeOutline} className="text-[15px] mr-1" />
          This message was deleted
        </div>
      );
    }

    if (msg.message_type === 'audio') {
      return (
        <div className="flex items-center text-muted-foreground text-[14px]">
          {tickIcon}
          <IonIcon icon={micOutline} className="text-orange-500 text-[15px] mr-1" /> 
          Voice message
        </div>
      );
    }

    if (msg.message_type === 'image') {
       return (
         <div className="flex items-center text-muted-foreground text-[14px]">
           {tickIcon}
           <IonIcon icon={imageOutline} className="text-[15px] mr-1" /> 
           Photo
         </div>
       );
    }

    if (msg.message_type === 'video') {
       return (
         <div className="flex items-center text-muted-foreground text-[14px]">
           {tickIcon}
           <IonIcon icon={playOutline} className="text-[15px] mr-1" /> 
           Video
         </div>
       );
    }

    return (
      <div className="flex items-center text-muted-foreground text-[14px] w-full">
        {tickIcon}
        <span className="truncate">{msg.content}</span>
      </div>
    );
  };

  // Functional Search & Filter logic
  const filteredChats = chats.filter(c => {
    // 1. Filter by unread status if active
    if (activeFilter === 'unread' && c.unreadCount === 0) return false;
    
    // 2. Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      const partnerName = (c.partner?.full_name || '').toLowerCase();
      const lastMsg = (c.latestMessage?.content || '').toLowerCase();
      
      if (!partnerName.includes(query) && !lastMsg.includes(query)) {
        return false;
      }
    }
    
    return true;
  });

  return (
    <div className="min-h-screen bg-background text-foreground pt-safe pb-20">

      {/* HEADER */}
      <div className="px-4 py-3 flex items-center justify-between sticky top-0 bg-background/95 backdrop-blur-sm z-30">
        <h1 className="text-2xl font-medium tracking-tight">Vendi Chats</h1>
        
        <div className="relative">
          <button 
            onClick={(e) => { e.stopPropagation(); setShowMenu((v) => !v); }} 
            className="!w-10 !h-10 !flex !items-center !justify-center active:scale-95 transition-transform !rounded-full text-muted-foreground hover:bg-muted"
          >
            <IonIcon icon={ellipsisVerticalOutline} className="text-2xl" />
          </button>
          
          {/* Dropdown Menu for Report Issue */}
          {showMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
              <div className="absolute right-2 top-12 min-w-[200px] bg-card !rounded-2xl shadow-xl border border-border overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-100">
                <button 
                  onClick={(e) => { e.stopPropagation(); router.push('/support'); }} 
                  className="!w-full !text-left !px-5 !py-4 text-[15px] font-bold text-foreground hover:!bg-muted transition-colors !flex items-center gap-3"
                >
                  <IonIcon icon={flagOutline} className="text-xl text-red-500" /> Report Issue
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* FUNCTIONAL SEARCH BAR */}
      <div className="px-3 pb-3">
        <div className="bg-muted !rounded-full flex items-center px-4 py-2.5">
          <IonIcon icon={searchOutline} className="text-muted-foreground text-lg mr-3" />
          <input 
            type="text" 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search chats..." 
            className="bg-transparent border-none outline-none text-[15px] w-full text-foreground placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {/* FILTER PILLS */}
      <div className="flex gap-2 px-4 pb-3 overflow-x-auto scrollbar-hide">
        <button 
          onClick={() => setActiveFilter('all')}
          className={`!px-4 !py-1.5 !rounded-full text-sm font-medium transition-colors ${activeFilter === 'all' ? 'bg-orange-500/10 text-orange-500' : 'bg-muted text-muted-foreground'}`}
        >
          All
        </button>
        <button 
          onClick={() => setActiveFilter('unread')}
          className={`!px-4 !py-1.5 !rounded-full text-sm font-medium transition-colors ${activeFilter === 'unread' ? 'bg-orange-500/10 text-orange-500' : 'bg-muted text-muted-foreground'}`}
        >
          Unread
        </button>
      </div>

      {/* CHAT LIST */}
      <div className="flex flex-col">
        {isLoading ? (
          <div className="p-4 space-y-4">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="flex gap-4 items-center animate-pulse">
                <div className="w-12 h-12 bg-muted !rounded-full flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-muted !rounded w-1/3" />
                  <div className="h-3 bg-muted !rounded w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredChats.length > 0 ? (
          filteredChats.map((chat) => (
            <div 
              key={chat.transaction_ref} 
              onClick={() => router.push(`/chats?seller=${chat.partner?.id}&ref=${chat.transaction_ref}`)}
              className="flex items-center gap-3 px-4 py-3 active:bg-muted/50 cursor-pointer transition-colors hover:bg-muted/50"
            >
              <Avatar src={chat.partner?.avatar_url} name={chat.partner?.full_name || "User"} size="lg" />

              <div className="flex-1 min-w-0 border-b border-border pb-3">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="font-medium text-[16px] text-foreground truncate pr-2">
                    {chat.partner?.full_name || "Vendi User"}
                  </h3>
                  <span className={`text-xs ${chat.unreadCount > 0 ? 'text-orange-500 font-bold' : 'text-muted-foreground'}`}>
                    {formatTime(chat.latestMessage.created_at)}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex-1 truncate pr-4">
                    {renderMessagePreview(chat.latestMessage)}
                  </div>
                  {chat.unreadCount > 0 && (
                    <div className="!bg-orange-500 text-white text-[11px] font-bold !w-5 !h-5 !min-w-[20px] !min-h-[20px] flex items-center justify-center !rounded-full flex-shrink-0 shadow-sm">
                      {chat.unreadCount}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="flex flex-col items-center justify-center pt-20 text-muted-foreground">
            <p className="text-[15px]">{searchQuery ? "No chats match your search." : "No chats found."}</p>
          </div>
        )}
      </div>
    </div>
  );
}