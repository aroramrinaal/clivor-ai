import { useState, useEffect, useRef } from 'react'
import './App.css'

function App() {
  const [count, setCount] = useState(0)
  const [connected, setConnected] = useState(false)
  const [messages, setMessages] = useState([])
  const [reviews, setReviews] = useState([])
  const [streamingContent, setStreamingContent] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [connectionDetails, setConnectionDetails] = useState('Connecting...')
  const wsRef = useRef(null)
  
  // Function to trigger test broadcast
  const triggerTestBroadcast = async () => {
    try {
      const response = await fetch('/api/test-broadcast')
      const data = await response.json()
      console.log('Test broadcast response:', data)
    } catch (err) {
      console.error('Error triggering test broadcast:', err)
    }
  }
  
  // Function to trigger test streaming
  const triggerTestStreaming = async () => {
    try {
      setIsStreaming(true)
      setStreamingContent('')
      const response = await fetch('/api/test-streaming')
      const data = await response.json()
      console.log('Test streaming response:', data)
    } catch (err) {
      console.error('Error triggering test streaming:', err)
      setIsStreaming(false)
    }
  }
  
  useEffect(() => {
    // Always use ws protocol and connect to the same host that serves the app
    // If running in dev mode with Vite, force connection to backend port 3000
    const protocol = 'ws'
    const host = import.meta.env.DEV ? 'localhost:3000' : window.location.host
    const wsUrl = `${protocol}://${host}`
    
    console.log('Connecting to WebSocket at:', wsUrl)
    setConnectionDetails(`Connecting to ${wsUrl}...`)
    
    // Create WebSocket connection
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws
    
    // Connection opened
    ws.addEventListener('open', () => {
      console.log('Connected to server')
      setConnected(true)
      setConnectionDetails('Connected successfully')
    })
    
    // Listen for messages
    ws.addEventListener('message', (event) => {
      try {
        console.log('Raw message received:', event.data)
        const data = JSON.parse(event.data)
        console.log('Message from server:', data)
        
        if (data.type === 'vocabulary') {
          setMessages(prev => [...prev, data])
        } 
        else if (data.type === 'review') {
          setReviews(prev => [...prev, data])
        }
        else if (data.type === 'streaming') {
          if (data.chunk) {
            setStreamingContent(prev => prev + data.chunk)
          }
          // If we get an end marker or error, stop streaming mode
          if (data.end || data.error) {
            setIsStreaming(false)
          }
        }
      } catch (err) {
        console.error('Error processing message:', err)
      }
    })
    
    // Connection closed
    ws.addEventListener('close', (event) => {
      console.log('Disconnected from server', event.code, event.reason)
      setConnected(false)
      setConnectionDetails(`Disconnected (code: ${event.code})`)
    })
    
    // Connection error
    ws.addEventListener('error', (error) => {
      console.error('WebSocket error:', error)
      setConnectionDetails('Connection error')
    })
    
    // Cleanup on unmount
    return () => {
      ws.close()
    }
  }, [])
  
  return (
    <div className="app-container">
      <div className="app-background"></div>
      
      <header>
        <div className="brand">
          <img src="/clivor.png" alt="Clivor Logo" className="clivor-logo" />
          <h1>Clivor.ai</h1>
        </div>
        
        <div className="connection-status">
          Status: {connected ? 
            <span className="connected">Connected</span> : 
            <span className="disconnected">Disconnected</span>}
          <div className="connection-details">{connectionDetails}</div>
        </div>
        
        <div className="test-controls">
          <button onClick={triggerTestBroadcast} className="test-button">
            Test WebSocket Broadcast
          </button>
          <button onClick={triggerTestStreaming} className="test-button" disabled={isStreaming}>
            {isStreaming ? 'Streaming...' : 'Test Streaming API'}
          </button>
        </div>
      </header>
      
      <main>
        {/* Streaming Section */}
        {streamingContent && (
          <section className="streaming-section">
            <h2>Streaming Content {isStreaming && <span className="streaming-indicator">•••</span>}</h2>
            <div className="streaming-container">
              <p>{streamingContent}</p>
            </div>
          </section>
        )}
      
        {/* Reviews Section */}
        {reviews.length > 0 && (
          <section className="reviews-section">
            <h2>Periodic Reviews</h2>
            <div className="reviews-container">
              {reviews.map((review, index) => (
                <div key={`review-${index}`} className="review-card">
                  <h3>Content Review</h3>
                  <div className="review-content">
                    <div dangerouslySetInnerHTML={{ __html: review.review.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }}></div>
                  </div>
                  {review.timestamp && (
                    <div className="timestamp">
                      {new Date(review.timestamp).toLocaleTimeString()}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      
        <section className="vocabulary-section">
          <h2>Real-time Analysis</h2>
          
          {messages.length === 0 ? (
            <div className="no-data">
              <p>Waiting for speech data...</p>
              <p>Start a Zoom meeting with RTMS enabled to see real-time translations and explanations.</p>
              <p>Or click the "Test WebSocket Broadcast" button above to test.</p>
            </div>
          ) : (
            <div className="messages-container">
              {messages.map((msg, index) => (
                <div key={`vocab-${index}`} className="message-card">
                  <div className="original-text">
                    <h3>English</h3>
                    <p>{msg.originalText}</p>
                  </div>
                  
                  {msg.translation && (
                    <div className="translation">
                      <h3>Spanish Translation</h3>
                      <div className="translation-content">
                        <p>{msg.translation}</p>
                      </div>
                    </div>
                  )}
                  
                  <div className="explanation">
                    <h3>Vocabulary Explanations</h3>
                    <div dangerouslySetInnerHTML={{ __html: msg.explanation }}></div>
                  </div>
                  
                  {msg.timestamp && (
                    <div className="timestamp">
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
      
      <footer>
        <p>Powered by Zoom RTMS and Google Gemini</p>
      </footer>
    </div>
  )
}

export default App
