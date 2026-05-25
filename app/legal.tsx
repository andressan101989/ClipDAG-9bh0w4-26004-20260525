import React, { useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView,
} from 'react-native';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';

type Doc = 'terms' | 'privacy' | 'community' | 'copyright' | 'monetization' | 'cookies';

interface DocConfig {
  key: Doc;
  icon: string;
  gradient: string[];
  title: string;
  version: string;
  updated: string;
  sections: { heading: string; content: string }[];
}

const DOCS: DocConfig[] = [
  {
    key: 'terms',
    icon: 'file-document-outline',
    gradient: ['#7C5CFF', '#B44FFF'],
    title: 'Terminos de Servicio',
    version: '2.1',
    updated: '1 ene 2025',
    sections: [
      {
        heading: '1. Aceptacion de los Terminos',
        content: 'Al acceder y usar ClipDAG, aceptas quedar vinculado por estos Terminos de Servicio. Si no estas de acuerdo con alguno de estos terminos, no podras usar la plataforma. Nos reservamos el derecho de actualizar estos terminos en cualquier momento con notificacion previa de 30 dias.',
      },
      {
        heading: '2. Uso de la Plataforma',
        content: 'ClipDAG es una plataforma de contenido creativo basada en blockchain. Puedes crear, compartir y monetizar contenido a traves de tokens $DAG. El uso de la plataforma esta sujeto a que tengas al menos 13 anos de edad y permiso de un padre o tutor si eres menor de 18 anos.',
      },
      {
        heading: '3. Cuentas de Usuario',
        content: 'Eres responsable de mantener la confidencialidad de tu cuenta y contrasena, y de restringir el acceso a tu dispositivo. Aceptas la responsabilidad de todas las actividades que ocurran bajo tu cuenta. Debes notificarnos inmediatamente sobre cualquier uso no autorizado.',
      },
      {
        heading: '4. Propiedad Intelectual',
        content: 'Retienes la propiedad de todo el contenido que subes a ClipDAG. Sin embargo, al subir contenido, nos otorgas una licencia mundial, no exclusiva, libre de regalias para usar, reproducir y distribuir tu contenido en conexion con la plataforma.',
      },
      {
        heading: '5. Terminacion del Servicio',
        content: 'Nos reservamos el derecho de suspender o terminar tu acceso a la plataforma en cualquier momento, por cualquier razon, incluyendo pero no limitado a violaciones de estos Terminos. Recibirás una notificacion previa salvo en casos de violaciones graves.',
      },
    ],
  },
  {
    key: 'privacy',
    icon: 'shield-check-outline',
    gradient: ['#2D9EFF', '#7C5CFF'],
    title: 'Politica de Privacidad',
    version: '3.0',
    updated: '15 ene 2025',
    sections: [
      {
        heading: 'Informacion que Recopilamos',
        content: 'Recopilamos informacion que proporcionas directamente (nombre, email, foto de perfil), informacion de uso (videos vistos, interacciones), informacion del dispositivo (tipo de dispositivo, sistema operativo, version de app), y datos de transacciones BlockDAG.',
      },
      {
        heading: 'Como Usamos tu Informacion',
        content: 'Usamos tu informacion para proporcionar y mejorar nuestros servicios, personalizar tu experiencia, procesar transacciones $DAG, enviarte notificaciones importantes, y cumplir con obligaciones legales. No vendemos tu informacion personal a terceros.',
      },
      {
        heading: 'Compartir Informacion',
        content: 'Podemos compartir tu informacion con proveedores de servicios que nos ayudan a operar la plataforma, cuando sea requerido por la ley, con tu consentimiento, o en caso de fusión o adquisición de la empresa.',
      },
      {
        heading: 'Seguridad de Datos',
        content: 'Implementamos medidas de seguridad tecnicas y organizativas para proteger tu informacion, incluyendo encriptacion SSL, autenticacion de dos factores, monitoreo de seguridad 24/7, y auditorias de seguridad regulares.',
      },
      {
        heading: 'Tus Derechos',
        content: 'Tienes derecho a acceder, corregir o eliminar tu informacion personal. Puedes solicitar una copia de tus datos, retirar tu consentimiento en cualquier momento, y presentar quejas ante la autoridad de proteccion de datos correspondiente.',
      },
    ],
  },
  {
    key: 'community',
    icon: 'account-group-outline',
    gradient: ['#00E5A0', '#2D9EFF'],
    title: 'Directrices de la Comunidad',
    version: '1.5',
    updated: '1 feb 2025',
    sections: [
      {
        heading: 'Contenido Permitido',
        content: 'ClipDAG es una plataforma para contenido creativo, educativo y de entretenimiento. Apoyamos a creadores que comparten contenido original, autentico y positivo. El contenido relacionado con blockchain, crypto, arte digital y creatividad es especialmente bienvenido.',
      },
      {
        heading: 'Contenido Prohibido',
        content: 'No se permite: contenido de odio, acoso o bullying; contenido sexualmente explicito; violencia grafica; desinformacion o noticias falsas; spam o comportamiento manipulador; violacion de derechos de autor; actividades ilegales o promocion de las mismas.',
      },
      {
        heading: 'Comportamiento en la Comunidad',
        content: 'Esperamos que todos los usuarios traten a los demas con respeto y dignidad. El acoso, las amenazas, la discriminacion y el comportamiento toxico resultaran en suspension o eliminacion permanente de la cuenta.',
      },
      {
        heading: 'Reportar Contenido',
        content: 'Si ves contenido que viola estas directrices, usa la funcion de reporte en la app. Nuestro equipo de moderacion revisa todos los reportes en menos de 48 horas. Los reportes criticos son atendidos en menos de 2 horas.',
      },
    ],
  },
  {
    key: 'copyright',
    icon: 'copyright',
    gradient: ['#FFB800', '#FF6B00'],
    title: 'Politica de Derechos de Autor',
    version: '1.2',
    updated: '1 mar 2025',
    sections: [
      {
        heading: 'Respeto a la Propiedad Intelectual',
        content: 'ClipDAG respeta los derechos de propiedad intelectual y espera que sus usuarios hagan lo mismo. Solo debes subir contenido del cual poseas los derechos o tengas permission expresa del titular de los derechos.',
      },
      {
        heading: 'Procedimiento de Reclamo DMCA',
        content: 'Si crees que tu trabajo protegido por derechos de autor ha sido utilizado sin autorizacion, puedes enviar una notificacion DMCA a copyright@clipdag.io incluyendo: identificacion del trabajo, ubicacion en nuestra plataforma, tu informacion de contacto y declaracion de buena fe.',
      },
      {
        heading: 'Musica y Audio',
        content: 'Para usar musica protegida por derechos de autor, debes obtener una licencia apropiada. ClipDAG ofrece una biblioteca de musica con licencia que puedes usar libremente. El uso no autorizado de musica puede resultar en la eliminacion del contenido.',
      },
    ],
  },
  {
    key: 'monetization',
    icon: 'currency-usd',
    gradient: ['#FF2D78', '#FF6FA8'],
    title: 'Politica de Monetizacion',
    version: '2.0',
    updated: '15 mar 2025',
    sections: [
      {
        heading: 'Sistema de Recompensas $DAG',
        content: 'Los creadores ganan 0.01 $DAG por cada like recibido en sus publicaciones. Los tokens $DAG son acumulados en tu billetera interna y pueden ser transferidos a una billetera BlockDAG externa una vez que alcances el minimo de retiro (50 $DAG).',
      },
      {
        heading: 'Regalos y Propinas',
        content: 'Los espectadores pueden enviar regalos virtuales durante streams en vivo y en publicaciones. El 85% del valor del regalo va directamente al creador, y el 15% es retenido por la plataforma como comision de servicio.',
      },
      {
        heading: 'Tienda de Creadores',
        content: 'Los creadores pueden vender productos digitales y fisicos a traves de la Tienda integrada. ClipDAG cobra una comision del 10% en cada venta. Los pagos se procesan dentro de los 7 dias habiles siguientes a la venta.',
      },
      {
        heading: 'Requisitos para Monetizar',
        content: 'Para acceder a todas las funciones de monetizacion debes: tener al menos 1000 seguidores, haber publicado al menos 10 piezas de contenido original, cumplir con todas las directrices de la comunidad, y verificar tu identidad.',
      },
      {
        heading: 'Impuestos y Regulaciones',
        content: 'Eres responsable de reportar y pagar los impuestos aplicables en tu jurisdiccion sobre los ingresos obtenidos en ClipDAG. ClipDAG puede estar obligado a reportar ingresos a las autoridades fiscales en algunos paises.',
      },
    ],
  },
  {
    key: 'cookies',
    icon: 'cookie-outline',
    gradient: ['#5A5A72', '#3D3D52'],
    title: 'Politica de Cookies',
    version: '1.0',
    updated: '1 ene 2025',
    sections: [
      {
        heading: 'Que son las Cookies',
        content: 'Las cookies son pequenos archivos de datos que se almacenan en tu dispositivo cuando visitas una aplicacion o sitio web. Usamos cookies y tecnologias similares para mejorar tu experiencia, analizar el uso de la plataforma y personalizar el contenido.',
      },
      {
        heading: 'Tipos de Cookies que Usamos',
        content: 'Cookies esenciales (necesarias para el funcionamiento basico), cookies de rendimiento (para analizar el uso de la app), cookies de funcionalidad (para recordar tus preferencias), y cookies de publicidad (para mostrar anuncios relevantes).',
      },
      {
        heading: 'Control de Cookies',
        content: 'Puedes controlar las cookies a traves de la configuracion de tu dispositivo. Ten en cuenta que deshabilitar ciertas cookies puede afectar la funcionalidad de la app. Puedes gestionar tus preferencias de cookies en cualquier momento desde la configuracion.',
      },
    ],
  },
];

function DocCard({ doc, onPress }: { doc: DocConfig; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.docCard, pressed && { opacity: 0.82 }]}
      onPress={onPress}
    >
      <LinearGradient colors={doc.gradient} style={styles.docCardIcon}>
        <MaterialCommunityIcons name={doc.icon as any} size={20} color="#fff" />
      </LinearGradient>
      <View style={styles.docCardMeta}>
        <Text style={styles.docCardTitle}>{doc.title}</Text>
        <Text style={styles.docCardSub}>v{doc.version} · Actualizado: {doc.updated}</Text>
      </View>
      <MaterialIcons name="chevron-right" size={20} color={Colors.textSubtle} />
    </Pressable>
  );
}

export default function LegalScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [activeDoc, setActiveDoc] = useState<DocConfig | null>(null);

  if (activeDoc) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <StatusBar style="light" />
        <View style={styles.header}>
          <Pressable onPress={() => setActiveDoc(null)} hitSlop={8}>
            <MaterialIcons name="arrow-back" size={24} color={Colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>{activeDoc.title}</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Doc meta */}
        <View style={styles.docMeta}>
          <LinearGradient colors={activeDoc.gradient} style={styles.docMetaIcon}>
            <MaterialCommunityIcons name={activeDoc.icon as any} size={18} color="#fff" />
          </LinearGradient>
          <View>
            <Text style={styles.docMetaTitle}>{activeDoc.title}</Text>
            <Text style={styles.docMetaSub}>Version {activeDoc.version} · {activeDoc.updated}</Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={[styles.docScroll, { paddingBottom: 60 + insets.bottom }]}
          showsVerticalScrollIndicator={false}
        >
          {activeDoc.sections.map((s, i) => (
            <View key={i} style={styles.docSection}>
              <Text style={styles.docSectionHeading}>{s.heading}</Text>
              <Text style={styles.docSectionContent}>{s.content}</Text>
            </View>
          ))}

          <View style={styles.docFooter}>
            <Text style={styles.docFooterText}>
              Si tienes preguntas sobre este documento, contactanos en legal@clipdag.io
            </Text>
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={24} color={Colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Legal y Politicas</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: 60 + insets.bottom }]}
      >
        <LinearGradient
          colors={['rgba(124,92,255,0.12)', 'rgba(255,45,120,0.08)']}
          style={styles.topBanner}
        >
          <MaterialCommunityIcons name="shield-check-outline" size={32} color={Colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.bannerTitle}>Tus derechos y nuestra responsabilidad</Text>
            <Text style={styles.bannerSub}>Documentos legales y politicas de ClipDAG v1.0</Text>
          </View>
        </LinearGradient>

        <View style={styles.docsCard}>
          {DOCS.map((doc, idx) => (
            <React.Fragment key={doc.key}>
              <DocCard doc={doc} onPress={() => setActiveDoc(doc)} />
              {idx < DOCS.length - 1 ? <View style={styles.separator} /> : null}
            </React.Fragment>
          ))}
        </View>

        <View style={styles.contactCard}>
          <Text style={styles.contactTitle}>Contacto Legal</Text>
          <Text style={styles.contactText}>
            Para consultas legales, solicitudes de datos o reportes de violaciones:
          </Text>
          <View style={styles.contactRow}>
            <MaterialCommunityIcons name="email-outline" size={15} color={Colors.primary} />
            <Text style={styles.contactEmail}>legal@clipdag.io</Text>
          </View>
          <View style={styles.contactRow}>
            <MaterialCommunityIcons name="copyright" size={15} color={Colors.primary} />
            <Text style={styles.contactEmail}>copyright@clipdag.io</Text>
          </View>
          <View style={styles.contactRow}>
            <MaterialCommunityIcons name="shield-lock-outline" size={15} color={Colors.primary} />
            <Text style={styles.contactEmail}>privacy@clipdag.io</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm,
  },
  headerTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.textPrimary, flex: 1, textAlign: 'center' },
  scroll: { paddingHorizontal: Spacing.md, paddingTop: 4, gap: Spacing.md },

  topBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    padding: Spacing.md, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: 'rgba(124,92,255,0.25)',
  },
  bannerTitle: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  bannerSub: { color: Colors.textSubtle, fontSize: FontSize.xs, marginTop: 2 },

  docsCard: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
  },
  docCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.md, paddingVertical: 14,
  },
  docCardIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  docCardMeta: { flex: 1, gap: 2 },
  docCardTitle: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  docCardSub: { color: Colors.textSubtle, fontSize: FontSize.xs },
  separator: { height: 1, backgroundColor: Colors.borderSubtle, marginLeft: Spacing.md + 38 + Spacing.md },

  contactCard: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.border,
    padding: Spacing.md, gap: Spacing.sm,
  },
  contactTitle: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.bold, marginBottom: 4 },
  contactText: { color: Colors.textSubtle, fontSize: FontSize.sm, lineHeight: 18 },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  contactEmail: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: FontWeight.medium },

  // Document reader
  docMeta: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.md, paddingBottom: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  docMetaIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  docMetaTitle: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  docMetaSub: { color: Colors.textSubtle, fontSize: FontSize.xs },
  docScroll: { padding: Spacing.md, gap: Spacing.lg },
  docSection: { gap: Spacing.sm },
  docSectionHeading: { color: Colors.primary, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  docSectionContent: { color: Colors.textSecondary, fontSize: FontSize.sm, lineHeight: 22 },
  docFooter: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.lg, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center',
  },
  docFooterText: { color: Colors.textSubtle, fontSize: FontSize.xs, textAlign: 'center', lineHeight: 18 },
});
