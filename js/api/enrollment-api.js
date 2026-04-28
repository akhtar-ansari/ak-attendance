// AK Attendance - Enrollment Link API
const EnrollmentAPI = {
    // Generate random token
    generateToken() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let token = '';
        for (let i = 0; i < 32; i++) {
            token += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return token;
    },

    // Create enrollment link for a labor
    async createLink(laborId) {
        try {
            const session = AUTH.getSession();
            const clientId = AUTH.getClientId();
            const token = this.generateToken();

            // Check if labor exists
            const { data: labor, error: laborError } = await supabaseClient
                .from('laborers')
                .select('labor_id, name')
                .eq('client_id', clientId)
                .eq('labor_id', laborId)
                .single();

            if (laborError || !labor) {
                throw new Error('Labor not found');
            }

            // Expire any existing pending links for this labor
            await supabaseClient
                .from('enrollment_links')
                .update({ status: 'expired' })
                .eq('client_id', clientId)
                .eq('labor_id', laborId)
                .eq('status', 'pending');

            // Create new link (expires in 1 hour)
            const expiresAt = new Date();
            expiresAt.setHours(expiresAt.getHours() + 1);

            const { data, error } = await supabaseClient
    .from('enrollment_links')
    .insert({
        token: token,
        labor_id: laborId,
        client_id: clientId,
        created_by: session.name,
        expires_at: expiresAt.toISOString(),
        status: 'pending',
        labor_name: labor.name
    })
                .select()
                .single();

            if (error) throw error;

            // Build full URL
            const baseUrl = window.location.origin + window.location.pathname.replace(/\/[^\/]*$/, '');
            const enrollUrl = `${baseUrl}/enroll-self.html?token=${token}`;

            return { 
                success: true, 
                data: {
                    token,
                    url: enrollUrl,
                    expiresAt: expiresAt.toISOString(),
                    laborName: labor.name
                }
            };
        } catch (error) {
            console.error('Create enrollment link error:', error);
            return { success: false, error: error.message };
        }
    },

    // Validate token (public - no auth required)
    async validateToken(token) {
        try {
            const { data, error } = await supabaseClient
                .from('enrollment_links')
                .select(`
                    *,
                    laborers:labor_id (
                        labor_id,
                        name,
                        client_id
                    )
                `)
                .eq('token', token)
                .single();

            if (error || !data) {
                return { success: false, error: 'Invalid link' };
            }

            // Check if expired
            if (new Date(data.expires_at) < new Date()) {
                return { success: false, error: 'Link has expired' };
            }

            // Check if already used
            if (data.status !== 'pending') {
                return { success: false, error: 'Link has already been used' };
            }

            return { 
                success: true, 
                data: {
                    id: data.id,
                    laborId: data.labor_id,
                    laborName: data.laborers?.name || 'Unknown',
                    clientId: data.client_id,
                    expiresAt: data.expires_at
                }
            };
        } catch (error) {
            console.error('Validate token error:', error);
            return { success: false, error: error.message };
        }
    },

    // Submit enrollment (public - no auth required)
    async submitEnrollment(token, photoUrl, faceDescriptor) {
        try {
            // Validate token first
            const validation = await this.validateToken(token);
            if (!validation.success) {
                return validation;
            }

            // Update the enrollment link with photo and descriptor
            const { error } = await supabaseClient
                .from('enrollment_links')
                .update({
                    photo_url: photoUrl,
                    face_descriptor: JSON.stringify(faceDescriptor),
                    status: 'submitted',
                    submitted_at: new Date().toISOString()
                })
                .eq('token', token)
                .eq('status', 'pending');

            if (error) throw error;

            return { success: true };
        } catch (error) {
            console.error('Submit enrollment error:', error);
            return { success: false, error: error.message };
        }
    },

    // Get pending enrollments (admin)
async getPendingEnrollments() {
    try {
        const clientId = AUTH.getClientId();

        const { data, error } = await supabaseClient
            .from('enrollment_links')
            .select('*')
            .eq('client_id', clientId)
            .eq('status', 'submitted')
            .order('submitted_at', { ascending: false });

        if (error) throw error;

            return { success: true, data: data || [] };
        } catch (error) {
            console.error('Get pending enrollments error:', error);
            return { success: false, error: error.message };
        }
    },

    // Get pending count (for badge)
    async getPendingCount() {
        try {
            const clientId = AUTH.getClientId();

            const { count, error } = await supabaseClient
                .from('enrollment_links')
                .select('id', { count: 'exact', head: true })
                .eq('client_id', clientId)
                .eq('status', 'submitted');

            if (error) throw error;

            return { success: true, count: count || 0 };
        } catch (error) {
            console.error('Get pending count error:', error);
            return { success: false, count: 0 };
        }
    },

    // Approve enrollment (admin)
async approveEnrollment(enrollmentId) {
    try {
        const clientId = AUTH.getClientId();

        // Get the enrollment record
        const { data: enrollment, error: fetchError } = await supabaseClient
            .from('enrollment_links')
            .select('*')
            .eq('id', enrollmentId)
            .eq('client_id', clientId)
            .eq('status', 'submitted')
            .single();

        if (fetchError || !enrollment) {
            throw new Error('Enrollment not found');
        }

        // Update laborer with face data
        const { error: laborError } = await supabaseClient
            .from('laborers')
            .update({
                face_descriptor: enrollment.face_descriptor,
                face_photo_url: enrollment.photo_url,
                face_enrolled: true,
                needs_reenrollment: false
            })
            .eq('client_id', clientId)
            .eq('labor_id', enrollment.labor_id);

        if (laborError) throw laborError;

        // Delete photo from storage
        if (enrollment.photo_url) {
            try {
                const url = new URL(enrollment.photo_url);
                const pathParts = url.pathname.split('/storage/v1/object/public/punch-photos/');
                if (pathParts[1]) {
                    await supabaseClient.storage
                        .from('punch-photos')
                        .remove([pathParts[1]]);
                }
            } catch (e) {
                console.warn('Failed to delete enrollment photo:', e);
            }
        }

        // Mark enrollment as approved and clear photo_url
        const { error: updateError } = await supabaseClient
            .from('enrollment_links')
            .update({ 
                status: 'approved',
                photo_url: null
            })
            .eq('id', enrollmentId);

        if (updateError) throw updateError;

        return { success: true };
    } catch (error) {
        console.error('Approve enrollment error:', error);
        return { success: false, error: error.message };
    }
},

        // Mark enrollment as approved
        const { error: updateError } = await supabaseClient
            .from('enrollment_links')
            .update({ status: 'approved' })
            .eq('id', enrollmentId);

        if (updateError) throw updateError;

        return { success: true };
    } catch (error) {
        console.error('Approve enrollment error:', error);
        return { success: false, error: error.message };
    }
},

    // Reject enrollment (admin)
    async rejectEnrollment(enrollmentId) {
        try {
            const clientId = AUTH.getClientId();

            const { error } = await supabaseClient
                .from('enrollment_links')
                .update({ status: 'rejected' })
                .eq('id', enrollmentId)
                .eq('client_id', clientId);

            if (error) throw error;

            return { success: true };
        } catch (error) {
            console.error('Reject enrollment error:', error);
            return { success: false, error: error.message };
        }
    },

    // Upload photo to Supabase storage (public)
    async uploadPhoto(file, laborId) {
        try {
            const fileName = `enrollment/${laborId}_${Date.now()}.jpg`;
            
            const { data, error } = await supabaseClient.storage
                .from('punch-photos')
                .upload(fileName, file, {
                    contentType: 'image/jpeg',
                    upsert: true
                });

            if (error) throw error;

            // Get public URL
            const { data: urlData } = supabaseClient.storage
                .from('punch-photos')
                .getPublicUrl(fileName);

            return { success: true, url: urlData.publicUrl };
        } catch (error) {
            console.error('Upload photo error:', error);
            return { success: false, error: error.message };
        }
    }
};
