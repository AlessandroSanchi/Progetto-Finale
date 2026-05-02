```mermaid
graph LR
    V(["Visitatore"])
    U(["Utente"])


    V --- 1(["Registrazione utente"])
    V --- 2(["Login"])

    U --- 3(["Avvio partita"])
    U --- 4(["Visualizza classifica"])
    U --- 5(["Logout"])

    3 -. "include" .-> 6(["Verifica autenticazione"])
    4 -. "include" .-> 6