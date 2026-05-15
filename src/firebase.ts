import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: 'AIzaSyCuA8WC-tBf8mlocZBtuXuwpsa5Im5J8_o',
  authDomain: 'snack-3a043.firebaseapp.com',
  projectId: 'snack-3a043',
  storageBucket: 'snack-3a043.firebasestorage.app',
  messagingSenderId: '308737467391',
  appId: '1:308737467391:web:a7e06bea626f0ada0fbdca',
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const googleProvider = new GoogleAuthProvider()
export const db = getFirestore(app)
export const isConfigured = true
