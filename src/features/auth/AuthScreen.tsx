"use client";

import { useState } from 'react';
import { IonContent, IonSpinner, IonIcon } from '@ionic/react';
import { moonOutline, sunnyOutline } from 'ionicons/icons';
import { supabase } from '../../lib/supabase';
import { NIGERIAN_UNIVERSITIES } from '../../constants/universities';

export default function AuthScreen() {
  const [isLogin, setIsLogin] = useState(true);
  const [isDark, setIsDark] = useState(document.documentElement.classList.contains('dark'));
  
  // Base Auth State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  // Extended User Data State
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  
  // Cascading Dropdown State
  const [selectedUniId, setSelectedUniId] = useState(NIGERIAN_UNIVERSITIES[0].id);
  const [campus, setCampus] = useState(NIGERIAN_UNIVERSITIES[0].campuses[0]);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Handle Theme Toggle
  const toggleTheme = () => {
    const htmlEl = document.documentElement;
    htmlEl.classList.toggle('dark');
    setIsDark(htmlEl.classList.contains('dark'));
  };

  const handleUniChange = (e: any) => {
    const uniId = e.target.value;
    setSelectedUniId(uniId);
    const uni = NIGERIAN_UNIVERSITIES.find(u => u.id === uniId);
    if (uni) setCampus(uni.campuses[0]); // Auto-select first campus of the new university
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        if (password !== confirmPassword) throw new Error("Passwords do not match.");

        const selectedUniName = NIGERIAN_UNIVERSITIES.find(u => u.id === selectedUniId)?.name;

        const { error } = await supabase.auth.signUp({ 
          email, password,
          options: {
            data: {
              first_name: firstName, last_name: lastName, username, phone,
              university: selectedUniName, campus: campus,
            }
          }
        });
        if (error) throw error;
      }
    } catch (error: any) {
      setErrorMsg(error.message || 'An error occurred during authentication.');
    } finally {
      setLoading(false);
    }
  };

  const inputClasses = "w-full bg-white dark:bg-[#1a2235] border border-gray-200 dark:border-gray-800 text-gray-900 dark:text-white px-5 py-4 rounded-2xl outline-none focus:border-orange-500 transition-colors shadow-sm";

  return (
    <IonContent className="bg-gray-50 dark:bg-[#0b1120]">
      <div className="relative flex flex-col justify-center items-center min-h-full px-6 py-12 bg-gray-50 dark:bg-[#0b1120] transition-colors duration-300">
        
        {/* Theme Toggle Button */}
        <button onClick={toggleTheme} className="absolute top-6 right-6 p-2 rounded-full bg-gray-200 dark:bg-gray-800 text-gray-800 dark:text-gray-200 shadow-md">
          <IonIcon icon={isDark ? sunnyOutline : moonOutline} className="text-xl" />
        </button>

        {/* Brand Logo & Name */}
        <div className="flex flex-col items-center mb-8 mt-4">
          <img src="/logo.png" alt="Campus Market" className="w-20 h-20 rounded-full object-cover mb-4 shadow-lg border-2 border-orange-500" />
          <h1 className="text-3xl font-black tracking-tighter text-orange-500">
            CAMPUS MARKET
          </h1>
          <p className="text-gray-500 text-sm mt-2 font-medium">
            {isLogin ? 'Welcome back to the marketplace' : 'Create your secure account'}
          </p>
        </div>

        {/* Auth Form */}
        <form onSubmit={handleAuth} className="w-full max-w-sm pb-8">
          {errorMsg && <div className="bg-red-500/10 border border-red-500/50 text-red-500 text-sm p-3 rounded-xl mb-4 text-center font-medium">{errorMsg}</div>}

          <div className="flex flex-col gap-4">
            {!isLogin && (
              <>
                <div className="flex gap-4">
                  <input type="text" placeholder="First Name" value={firstName} onChange={(e) => setFirstName(e.target.value)} required={!isLogin} className={inputClasses} />
                  <input type="text" placeholder="Last Name" value={lastName} onChange={(e) => setLastName(e.target.value)} required={!isLogin} className={inputClasses} />
                </div>
                
                <input type="text" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} required={!isLogin} className={inputClasses} />
                <input type="tel" placeholder="Phone Number" value={phone} onChange={(e) => setPhone(e.target.value)} required={!isLogin} className={inputClasses} />

                {/* Cascading Dropdowns */}
                <select value={selectedUniId} onChange={handleUniChange} className={inputClasses + " appearance-none font-bold"}>
                  {NIGERIAN_UNIVERSITIES.map(uni => (
                    <option key={uni.id} value={uni.id}>{uni.name}</option>
                  ))}
                </select>

                <select value={campus} onChange={(e) => setCampus(e.target.value)} className={inputClasses + " appearance-none"}>
                  {(NIGERIAN_UNIVERSITIES.find(u => u.id === selectedUniId)?.campuses || []).map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </>
            )}

            <input type="email" placeholder="Student Email" value={email} onChange={(e) => setEmail(e.target.value)} required className={inputClasses} />
            <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required className={inputClasses} />

            {!isLogin && (
              <input type="password" placeholder="Confirm Password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required={!isLogin} className={inputClasses} />
            )}
          </div>

          <button type="submit" disabled={loading} className="w-full bg-orange-500 hover:bg-orange-600 text-white font-black text-xl py-5 rounded-[2rem] mt-8 transition-all shadow-xl flex justify-center items-center disabled:opacity-70">
            {loading ? <IonSpinner name="crescent" color="light" /> : (isLogin ? 'Sign In' : 'Create Account')}
          </button>
        </form>

        <button onClick={() => { setIsLogin(!isLogin); setErrorMsg(''); }} className="mb-12 text-gray-500 hover:text-gray-900 dark:hover:text-white text-sm font-bold transition-colors">
          {isLogin ? "Don't have an account? Sign Up" : "Already have an account? Sign In"}
        </button>
      </div>
    </IonContent>
  );
}